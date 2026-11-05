/* InfraTrack Overview — map-first study area selection.
   Basemap is not a dated Sentinel observation. Previews are real 2 km
   Sentinel-2 COG crops checked for local SCL clear-pixel coverage. */
(function(root){
"use strict";
const extraction=root.InfraExtractionLink;
const core=typeof module==="object"&&module.exports?
 require("./monitor_workspace_core.js"):root.InfraWorkspaceCore;
const preview=typeof module==="object"&&module.exports?
 require("./custom_preview.js"):root.InfraCustomPreview;
if(!core||!preview)throw Error("Overview requires the shared Sentinel workspace helpers");
const $=id=>document.getElementById(id);
const STAC="https://earth-search.aws.element84.com/v1/search";
const IMAGERY="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREETS="https://tile.openstreetmap.org/{z}/{x}/{y}.png";
let map=null,basemap=null,basemapType="satellite",tileErrors=0;
let areas=[],selected=null,markers=new Map(),footprints=new Map();
let newMode=false,newPoint=null,newRectangle=null;
let previewRevision=0,previewController=null,selectedPreviewCache=new Map();
let extractionFrame=0;
const EXTERNAL_ATTRIBUTION='Sources: Esri, Vantor, Earthstar Geographics, and the GIS User Community';
function elt(tag,contents,cls){
 const e=document.createElement(tag);
 if(contents!==undefined)e.textContent=contents;
 if(cls)e.className=cls;
 return e;
}
function dateLabel(iso){
 return core.humanDate(iso)||iso||"Date unavailable";
}
function mergeAreas(registry,saved){
 const used=new Set(),out=[];
 for(const x of [...(Array.isArray(registry)?registry:[]),...(Array.isArray(saved)?saved:[])]){
  if(!x||typeof x.id!=="string"||used.has(x.id)||
     !core.isAllowed(Number(x.lat),Number(x.lon)))continue;
  used.add(x.id);
  out.push({...x,category:x.category||
    (x.id.startsWith("custom-")?"saved":"registered")});
 }
 return out;
}
function previewCandidates(features,area){
 return core.catalogScenes(features,area,95)
  .filter(x=>typeof x.assets?.visual?.href==="string"&&
    x.assets.visual.href.startsWith("https://"))
  .filter(x=>{const cloud=core.sceneCloud(x);return cloud===null||cloud<95});
}
function savedAreas(){
 try{return core.readSaved(root.localStorage)}catch{return []}
}
function rememberArea(area){
 try{
  const existing=savedAreas();
  if(existing.length>=50)throw Error("Maximum 50 personal study areas");
  root.localStorage.setItem(core.KEY,JSON.stringify(existing.concat(area)));
  return true;
 }catch(e){$("newAreaStatus").textContent=
    "Unable to save this location in browser storage: "+e.message;return false}
}
function activeLink(site){
 return "monitor.html?site="+encodeURIComponent(site.id);
}
function positionRect(site){
 const [w,s,e,n]=core.bounds(site);
 return [[s,w],[n,e]];
}
function pin(index,isSelected){
 return root.L.divIcon({className:"",html:'<span class="site-marker'+
  (isSelected?' is-selected':'')+'">'+String(index+1).padStart(2,"0")+"</span>",
  iconSize:[30,30],iconAnchor:[15,15]});
}
function clearExtraction(){
 if(extractionFrame&&root.cancelAnimationFrame)root.cancelAnimationFrame(extractionFrame);
 extractionFrame=0;
 if(extraction)extraction.clear($("areaExtraction"));
 const imageBox=document.querySelector("#overviewDetail .preview-container");
 imageBox?.classList.remove("is-extracted");
}
function updateExtraction(){
 if(!extraction||!map||!selected||newMode||$("overviewDetail").hidden){
  if(extraction)extraction.clear($("areaExtraction"));return;
 }
 const main=$("overviewRoot"),previewBox=document.querySelector("#overviewDetail .preview-container");
 if(!main||!previewBox)return;
 const viewport=main.getBoundingClientRect();
 const mapBox=map.getContainer().getBoundingClientRect();
 const box=previewBox.getBoundingClientRect();
 const [[south,west],[north,east]]=positionRect(selected);
 const nw=map.latLngToContainerPoint([north,west]);
 const se=map.latLngToContainerPoint([south,east]);
 const offX=mapBox.left-viewport.left,offY=mapBox.top-viewport.top;
 const source={left:Math.min(nw.x,se.x)+offX,right:Math.max(nw.x,se.x)+offX,
  top:Math.min(nw.y,se.y)+offY,bottom:Math.max(nw.y,se.y)+offY};
 const target={left:box.left-viewport.left,right:box.right-viewport.left,
  top:box.top-viewport.top,bottom:box.bottom-viewport.top};
 const frame={width:viewport.width,height:viewport.height};
 extraction.render($("areaExtraction"),extraction.geometry(source,target,frame),frame);
}
function scheduleExtraction(){
 if(extractionFrame||!root.requestAnimationFrame)return;
 extractionFrame=root.requestAnimationFrame(()=>{
  extractionFrame=0;
  updateExtraction();
 });
}
function markSelection(){
 for(const [id,marker] of markers)
  marker.setIcon(pin(areas.findIndex(a=>a.id===id),selected?.id===id));
 for(const [id,rect] of footprints){
  const active=selected?.id===id;
  rect.setStyle({color:active?"#D49A58":"#D2D7CC",
    weight:active?2:1,fillOpacity:active?.08:.018,
    dashArray:active?null:"5 5"});
  rect.getElement()?.classList.toggle("extract-footprint",active);
 }
 for(const item of $("overviewAreaList").querySelectorAll("button[data-site]")){
  const active=item.dataset.site===selected?.id;
  item.classList.toggle("active",active);
  item.setAttribute("aria-pressed",String(active));
 }
}
function renderAreas(){
 const list=$("overviewAreaList");list.replaceChildren();
 $("areaCount").textContent=String(areas.length).padStart(2,"0");
 if(!areas.length){
  list.append(elt("p","No areas yet. Select Add location to mark your first 2 km square.","overview-placeholder"));
  return;
 }
 areas.forEach((site,index)=>{
  const b=elt("button",undefined,"overview-area");
  b.type="button";b.dataset.site=site.id;
  b.append(elt("span",String(index+1).padStart(2,"0"),"area-number"));
  const label=elt("span",undefined,"area-text");
  label.append(elt("strong",site.name||"Unnamed study area"));
  label.append(elt("small",site.region||(site.category==="saved"?"Personal area":"Registered study")));
  b.append(label,elt("span","›","area-chevron"));
  b.onclick=()=>selectArea(site);
  list.append(b);
 });
 markSelection();
}
function showAll(){
 if(!map)return;
 const coords=areas.map(a=>[Number(a.lat),Number(a.lon)]);
 if(!coords.length){map.setView([48.5,16],5);return}
 const box=root.L.latLngBounds(coords);
 if(coords.length===1)map.flyTo(coords[0],10,{animate:true,duration:1.1});
 else map.flyToBounds(box.pad(.3),{padding:[70,90],maxZoom:11,duration:1.2});
}
function setBasemap(style){
 if(!map||!root.L)return;
 if(basemap)map.removeLayer(basemap);
 basemapType=style;tileErrors=0;
 const opts=style==="satellite"?
  {maxZoom:19,attribution:EXTERNAL_ATTRIBUTION}:
  {maxZoom:19,attribution:'© OpenStreetMap contributors'};
 basemap=root.L.tileLayer(style==="satellite"?IMAGERY:STREETS,opts).addTo(map);
 if(style==="satellite")basemap.on("tileerror",()=>{
  tileErrors++;
  if(tileErrors>=5&&basemapType==="satellite"){
   setBasemap("streets");
   $("basemapStatus").textContent="Aerial basemap unavailable. Switched to the street map.";
  }
 });
 $("basemapToggle").textContent=style==="satellite"?"Streets":"Satellite";
 $("basemapToggle").setAttribute("aria-label",
  style==="satellite"?"Switch to street map":"Switch to satellite basemap");
}
function mapAreaLayers(){
 for(const layer of markers.values())map.removeLayer(layer);
 for(const layer of footprints.values())map.removeLayer(layer);
 markers.clear();footprints.clear();
 areas.forEach((site,index)=>{
  const marker=root.L.marker([site.lat,site.lon],{icon:pin(index,false),keyboard:true}).addTo(map);
  marker.bindTooltip(site.name||"Study area",{direction:"top",offset:[0,-20],className:"site-tooltip"});
  marker.on("click",()=>selectArea(site));
  const rect=root.L.rectangle(positionRect(site),{color:"#D2D7CC",
   weight:1,fillOpacity:.018,dashArray:"5 5"}).addTo(map);
  rect.on("click",()=>selectArea(site));
  markers.set(site.id,marker);footprints.set(site.id,rect);
 });
 markSelection();
}
function cancelPreview(){
 previewRevision++;
 if(previewController)previewController.abort();
 previewController=null;
}
function previewStatus(message){$("detailStatus").textContent=message}
function clearPreview(){
 $("detailDate").textContent="—";
 $("detailCloud").textContent="Checking local cloud quality…";
 $("detailScene").textContent="";
 $("detailImage").hidden=true;
 $("detailImage").removeAttribute("src");
 document.querySelector("#overviewDetail .preview-container")?.classList.remove("is-ready");
 $("previewPlaceholder").hidden=false;
 $("previewPlaceholder").replaceChildren(
  elt("span","▧"),elt("strong","Loading satellite preview"),
  elt("span","Checking original Sentinel-2 observations…"));
 previewStatus("Looking for a real, locally clear acquisition.");
}
function showPreview(scene){
 $("detailImage").src=scene.image;
 $("detailImage").hidden=false;
 $("previewPlaceholder").hidden=true;
 document.querySelector("#overviewDetail .preview-container")?.classList.add("is-ready");
 scheduleExtraction();
 $("detailDate").textContent=dateLabel(scene.date);
 const local=scene.cloudFraction;
 $("detailCloud").textContent=
  Number.isFinite(local)?Math.round(local*100)+"% locally clear":"Local screening unavailable";
 $("detailScene").textContent=Number.isFinite(scene.globalCloud)?
  Math.round(scene.globalCloud)+"% scene cloud":"Cloud data unavailable";
 previewStatus("Original Sentinel-2 L2A · cropped to this 2 km study area. Local SCL screened; date and source may differ from the map basemap.");
}
function previewError(message){
 document.querySelector("#overviewDetail .preview-container")?.classList.remove("is-ready");
 $("previewPlaceholder").replaceChildren(
  elt("span","◌"),elt("strong","No verified preview"),
  elt("span","The map location is available, but a clear Sentinel-2 crop was not verified."));
 $("detailCloud").textContent="Local quality unavailable";
 $("detailDate").textContent="Not verified";
 previewStatus(message);
}
async function loadPreview(area){
 cancelPreview();
 const sequence=previewRevision;
 const controller=new AbortController();previewController=controller;
 const cached=selectedPreviewCache.get(area.id);
 if(cached){showPreview(cached);return}
 clearPreview();
 const stop=()=>controller.signal.aborted||sequence!==previewRevision||selected?.id!==area.id;
 try{
  const bbox=core.bounds(area),now=new Date();
  const from=new Date(now.getTime()-365*86400000);
  const body={collections:["sentinel-2-c1-l2a"],bbox,
    datetime:from.toISOString().slice(0,10)+"T00:00:00Z/"+
      now.toISOString().slice(0,10)+"T23:59:59Z",limit:100};
  const response=await fetch(STAC,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body),signal:controller.signal});
  if(!response.ok)throw Error("Satellite catalog unavailable (HTTP "+response.status+")");
  const catalog=await response.json();
  if(stop())return;
  const candidates=previewCandidates(catalog.features,area);
  let checked=0;
  for(const item of candidates){
   if(stop())return;
   checked++;
   previewStatus("Checking "+dateLabel(core.sceneDate(item))+
    " · candidate "+checked+" of 8 for local cloud quality…");
   try{
    const observation=await preview.renderSelected(area,[item],{
      signal:controller.signal,minClear:.65,requireLocalScreening:true});
    if(stop())return;
    const result=observation.scenes[0];
    if(result.cloudFraction===null||result.cloudFraction<.65)
      throw Error("Insufficient locally clear pixels");
    selectedPreviewCache.set(area.id,result);
    showPreview(result);
    return;
   }catch(err){
    if(stop())return;
   }
   if(checked>=8)break;
  }
  if(stop())return;
  previewError(checked?
   "No locally usable original Sentinel-2 image among the "+checked+
   " checked acquisitions (≥65% clear required). Open Monitor to explore other dates.":
   "No candidate observation was available for local cloud screening. Open Monitor for the full timeline.");
 }catch(err){
  if(stop())return;
  previewError("Unable to retrieve a locally screened crop: "+(err?.message||"unknown error")+
   ". You can still open this area's workspace.");
 }
}
function selectArea(area,options={}){
 if(!area||!map)return;
 clearExtraction();
 if(newMode)cancelAdding();
 selected=area;markSelection();
 $("overviewDetail").hidden=false;
 const panel=$("overviewDetail");
 panel.classList.remove("extract-enter");
 // Restart extraction animation for every distinct selection.
 void panel.offsetWidth;
 panel.classList.add("extract-enter");
 panel.querySelector(".preview-container")?.classList.add("is-extracted");
 scheduleExtraction();
 $("newAreaPanel").hidden=true;
 $("detailName").textContent=area.name||"Unnamed area";
 $("detailRegion").textContent=(area.region||"Personal observation area")+
  " · "+Number(area.lat).toFixed(4)+"°, "+Number(area.lon).toFixed(4)+"°";
 $("openWorkspace").href=activeLink(area);
 if(options.fly!==false){
  map.flyTo([area.lat,area.lon],12,{animate:true,duration:1.1});
 }
 // Deep link to a map selection; the workspace has its own ?site=id route.
 try{history.replaceState(null,"","./?site="+encodeURIComponent(area.id))}catch{}
 void loadPreview(area);
}
function beginAdding(){
 cancelPreview();clearExtraction();selected=null;markSelection();newMode=true;newPoint=null;
 if(newRectangle){map.removeLayer(newRectangle);newRectangle=null}
 $("overviewDetail").hidden=true;$("newAreaPanel").hidden=false;
 $("newAreaCoordinates").textContent="No map point selected yet.";
 $("newAreaStatus").textContent="Click the map to mark the centre of a 2 km square.";
 $("saveNewArea").disabled=true;
 $("addAreaMap").textContent="Selecting on map…";
 map.getContainer().style.cursor="crosshair";
}
function cancelAdding(){
 newMode=false;newPoint=null;
 if(newRectangle){map.removeLayer(newRectangle);newRectangle=null}
 $("newAreaPanel").hidden=true;
 $("addAreaMap").textContent="+ Add location";
 map.getContainer().style.cursor="";
}
function mapClicked(ev){
 if(!newMode)return;
 const lat=ev.latlng.lat,lon=ev.latlng.lng;
 if(!core.isAllowed(lat,lon)){
  $("newAreaStatus").textContent="Only European study coordinates are supported.";
  return;
 }
 newPoint={lat,lon};
 if(newRectangle)map.removeLayer(newRectangle);
 newRectangle=root.L.rectangle(positionRect({...newPoint,size_km:2}),{
  color:"#D49A58",weight:2,fillOpacity:.07,dashArray:"5 4"
 }).addTo(map);
 $("newAreaCoordinates").textContent=lat.toFixed(5)+"°, "+lon.toFixed(5)+"°";
 $("newAreaStatus").textContent="2 × 2 km window selected. Name this area to save it.";
 $("saveNewArea").disabled=false;
}
function saveArea(){
 if(!newPoint)return;
 const name=$("newAreaName").value.trim();
 if(name.length<2||name.length>60){
  $("newAreaStatus").textContent="Enter an area name between 2 and 60 characters.";return;
 }
 const area={id:"custom-"+Date.now()+"-"+Math.floor(Math.random()*999999),
  name,...newPoint,size_km:2,type:$("newAreaType").value,
  category:"saved",status:"metadata_only"};
 if(!core.validSaved(area)||!rememberArea(area))return;
 areas=mergeAreas(areas,[area]);
 $("newAreaName").value="";
 cancelAdding();mapAreaLayers();renderAreas();
 selectArea(area);
}
async function loadAreas(){
 let projects=[],message="";
 try{
  const r=await fetch("projects.json",{cache:"no-store"});
  if(!r.ok)throw Error("Study registry HTTP "+r.status);
  const manifest=await r.json();
  projects=(Array.isArray(manifest.sites)?manifest.sites:[]).map(x=>({...x,category:"registered"}));
 }catch(err){message="Registered areas unavailable; showing saved locations only."}
 areas=mergeAreas(projects,savedAreas());
 mapAreaLayers();renderAreas();showAll();
 $("mapNote").textContent=message||
  "2 km study footprints · map imagery is a basemap, not a dated Sentinel-2 observation.";
 const requested=new URLSearchParams(location.search).get("site");
 const initial=areas.find(a=>a.id===requested);
 if(initial)selectArea(initial,{fly:false});
}
function setupMap(){
 if(!root.L){
  $("overviewAreaList").replaceChildren(elt("p",
   "Interactive map could not load. Check your connection and reload.","overview-placeholder"));
  return false;
 }
 map=root.L.map("overviewMap",{zoomControl:false,preferCanvas:true,
  scrollWheelZoom:true}).setView([48,16],5);
 root.L.control.zoom({position:"topright"}).addTo(map);
 setBasemap("satellite");
 map.on("click",mapClicked);
 map.on("move zoom zoomanim moveend zoomend resize",scheduleExtraction);
 if(root.ResizeObserver){
  const observer=new root.ResizeObserver(scheduleExtraction);
  observer.observe($("overviewRoot"));
  observer.observe($("overviewDetail"));
  observer.observe(document.querySelector("#overviewDetail .preview-container"));
 }
 root.addEventListener("resize",scheduleExtraction);
 return true;
}
function wire(){
 $("fitAll").onclick=showAll;
 $("basemapToggle").onclick=()=>setBasemap(basemapType==="satellite"?"streets":"satellite");
 $("addAreaMap").onclick=()=>{if(newMode)cancelAdding();else beginAdding()};
 $("cancelNewArea").onclick=cancelAdding;
 $("closeAreaDetail").onclick=()=>{
  $("overviewDetail").hidden=true;
  clearExtraction();selected=null;cancelPreview();markSelection();
  try{history.replaceState(null,"","./")}catch{}
 };
 $("saveNewArea").onclick=saveArea;
 $("newAreaName").addEventListener("keydown",e=>{if(e.key==="Enter")saveArea()});
 document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&newMode)cancelAdding();
  else if(e.key==="Escape"&&!$("overviewDetail").hidden)
   $("closeAreaDetail").click();
 });
}
async function start(){
 wire();
 if(!setupMap())return;
 await loadAreas();
}
if(typeof module==="object"&&module.exports)
 module.exports={mergeAreas,activeLink,positionRect,dateLabel,previewCandidates};
else start();
})(typeof window!=="undefined"?window:globalThis);
