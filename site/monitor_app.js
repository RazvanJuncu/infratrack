/* InfraTrack Monitor — static browser watchlist and real STAC acquisition monitoring.
   User-defined areas are local-only until a server-side AOI processing pipeline
   is explicitly configured. Never claim custom spectral change detection. */
(function(global) {
"use strict";
const STORE="infratrack:watchlist:v1";
const API="https://earth-search.aws.element84.com/v1/search";
const COLLECTION="sentinel-2-c1-l2a";
const EUR={west:-25,east:45,south:34,north:72};
function allowed(lat,lon){
 return Number.isFinite(lat)&&Number.isFinite(lon)&&
   lat>=EUR.south&&lat<=EUR.north&&lon>=EUR.west&&lon<=EUR.east;
}
function bounds(lat,lon,sizeKm=2) {
 if(!allowed(lat,lon)||sizeKm<.2||sizeKm>4)throw Error("Select a European study area");
 const deltaLat=sizeKm/(2*111.32);
 const deltaLon=sizeKm/(2*111.32*Math.cos(lat*Math.PI/180));
 return [lon-deltaLon,lat-deltaLat,lon+deltaLon,lat+deltaLat];
}
function validCustom(raw) {
 return raw && /^custom-[0-9]+(?:-[0-9]+)?$/.test(raw.id) &&
   typeof raw.name==="string"&&raw.name.trim().length>=2&&raw.name.length<=60&&
   allowed(raw.lat,raw.lon)&&raw.size_km===2&&
   ["construction","farmland","forest","urban","other"].includes(raw.type);
}
function readSaved(storage) {
 try{
   const items=JSON.parse(storage?.getItem(STORE)||"[]");
   if(!Array.isArray(items))return [];
   const seen=new Set();
   return items.filter(x=>{
      if(!validCustom(x)||seen.has(x.id))return false;
      seen.add(x.id);return true;
   }).slice(0,50);
 }catch{return [];}
}
function dateBounds(days,reference=new Date()) {
 if(!Number.isInteger(days)||days<1||days>366)throw Error("Invalid date range");
 const start=new Date(reference.getTime()-days*86400000);
 return [start.toISOString().slice(0,10),reference.toISOString().slice(0,10)];
}
function searchBody(area,days=90,reference=new Date()) {
 const [start,end]=dateBounds(days,reference);
 const [west,south,east,north]=bounds(area.lat,area.lon,area.size_km||2);
 return {collections:[COLLECTION],bbox:[west,south,east,north],
         datetime:start+"T00:00:00Z/"+end+"T23:59:59Z",limit:100};
}
function parseScenes(response,days,reference=new Date()){
 const [start]=dateBounds(days,reference);
 const entries=(Array.isArray(response?.features)?response.features:[])
    .filter(x=>typeof x?.properties?.datetime==="string"&&
       x.properties.datetime.slice(0,10)>=start&&
       x.properties.datetime.slice(0,10)<=reference.toISOString().slice(0,10))
    .sort((a,b)=>b.properties.datetime.localeCompare(a.properties.datetime));
 const seen=new Set();const result=[];
 for(const item of entries){
   const day=item.properties.datetime.slice(0,10);
   if(seen.has(day))continue;
   seen.add(day);
   const cloud=Number(item.properties["eo:cloud_cover"]);
   result.push({date:day,id:item.id,
      cloud_percent:Number.isFinite(cloud)?Math.round(cloud):null});
 }
 return result.slice(0,18);
}
// Keep a maximum of two explicit observation choices; never auto-substitute.
function toggleSceneIds(current,id,max=2){
 if(typeof id!=="string"||!id)return current.slice();
 const next=current.filter(x=>x!==id);
 if(next.length!==current.length)return next;
 next.push(id);
 while(next.length>max)next.shift();
 return next;
}
function orderedScenes(items){
 return items.slice().sort((a,b)=>a.date.localeCompare(b.date));
}
function clipValue(percent){
 const fraction=Math.max(0,Math.min(100,Number(percent)||0));
 return "inset(0 "+(100-fraction)+"% 0 0)";
}
const core={STORE,allowed,bounds,validCustom,readSaved,dateBounds,searchBody,parseScenes,toggleSceneIds,orderedScenes,clipValue};
if(typeof module==="object"&&module.exports)module.exports=core;
if(!global.document)return;
const $=id=>document.getElementById(id);
let sites=[],customs=[],selected=null,selection=null,map=null,pin=null,rect=null;
let fetchId=0,manifest=null,activePreview=null;
let catalogScenes=[],catalogById=new Map(),chosenSceneIds=[],compareMode="overlay";
const previewCache=new Map();
function say(s){$("monitorStatus").textContent=s;}
function save(){
 try{localStorage.setItem(STORE,JSON.stringify(customs));return true;}
 catch{say("Browser storage unavailable. This area will only be saved until the page closes.");return false;}
}
function makeElement(tag,text,className){
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 if(className)el.className=className;
 return el;
}
function makeMap(){
 if(typeof L==="undefined"){$("map").textContent="Map unavailable: Leaflet could not load.";return;}
 map=L.map("map",{scrollWheelZoom:false}).setView([49.5,15],5);
 L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 map.on("click",e=>{
   if(!allowed(e.latlng.lat,e.latlng.lng)){say("Choose a location within the European map area.");return}
   selection={lat:e.latlng.lat,lon:e.latlng.lng};
   $("pointCoordinates").textContent=selection.lat.toFixed(5)+", "+selection.lon.toFixed(5);
   drawSelected(selection.lat,selection.lon);
   say("2 × 2 km area selected. Give it a name and press Save area.");
 });
}
function drawSelected(lat,lon){
 if(!map)return;
 const box=bounds(lat,lon);
 if(pin)map.removeLayer(pin);
 if(rect)map.removeLayer(rect);
 pin=L.circleMarker([lat,lon],{radius:6,fillColor:"#4bccb3",color:"#fff",fillOpacity:1}).addTo(map);
 rect=L.rectangle([[box[1],box[0]],[box[3],box[2]]],
       {color:"#54cdb8",weight:2,fillOpacity:.07}).addTo(map);
}
function renderSites(){
 $("areaList").replaceChildren();
 for(const site of sites){
   const button=makeElement("button",null,"area-item"+(selected?.id===site.id?" active":""));
   const strong=makeElement("strong",site.name);
   const info=makeElement("small",site.category==="saved"?
      "My area · on-demand satellite comparison":(site.status==="ready"?"Processed imagery":"No processed imagery"));
   button.append(strong,info);
   button.onclick=()=>choose(site);
   $("areaList").append(button);
 }
}
async function refreshPublished(site,request){
 const p=site.path;
 const [r,old]=await Promise.all([
   fetch(p+"recent.json",{cache:"no-store"}),
   fetch(p+"data.json",{cache:"no-store"})
 ]);
 if(request!==fetchId)return;
 const recent=r.ok?await r.json():null;
 const historical=old.ok?await old.json():null;
 if(request!==fetchId)return;
 const ready=recent?.status==="ready";
 let before="",after="",dates=[];
 if(ready){
   before=p+"recent_before.png";after=p+"recent_after.png";
   dates=[recent.before_date,recent.after_date];
   $("imageNote").textContent="Recent locally cloud-screened Sentinel-2 views. The two dates can be weeks apart; changes are not classified automatically.";
 }else if(historical?.status==="ready"){
   before=p+"before.png";after=p+"after.png";
   dates=(historical.dates?.length?
       [historical.dates[0]?.date,historical.dates[1]?.date]:
       [historical.before?.date,historical.after?.date]);
   $("imageNote").textContent="Historical fallback only. Recent clear scenes were not available for this area.";
 }else{
   $("pair").hidden=true;
   $("imageNote").textContent="No processed image pair available; latest scene metadata may still be listed below.";
   return;
 }
 $("beforeImage").src=before;
 $("afterImage").src=after;
 $("beforeDate").textContent="BEFORE · "+(dates[0]||"?");
 $("afterDate").textContent="AFTER · "+(dates[1]||"?");
 $("pair").hidden=false;
 if(ready){
   $("recentSummary").textContent=(recent.significant_candidate_count||0)+
    " unverified change candidates · "+
    recent.joint_clear_percent+"% overlap clear in both scenes";
 }else{
   $("recentSummary").textContent="No recent reliable pair; historical images only.";
 }
}
async function choose(site){
 if(activePreview)activePreview.aborted=true;
 activePreview=null;
 chosenSceneIds=[];
 catalogScenes=[];catalogById=new Map();previewCache.clear();
 $("singleScene").hidden=true;$("overlay").hidden=true;
 $("pair").hidden=true;$("selectedTools").hidden=true;
 $("selectedStatus").textContent="No dates selected · choose one or two observations below";
 selected=site;renderSites();
 $("selectionName").textContent=site.name;
 $("selectionKind").textContent=site.category==="saved"?
  "My saved area · 2 km study square · browser-rendered images":"Registered research area · 2 km study square";
 $("pair").hidden=true;
 $("recentSummary").textContent="";
 $("imageNote").textContent="Loading source information…";
 drawSelected(site.lat,site.lon);
 if(map)map.setView([site.lat,site.lon],site.category==="saved"?13:12);
 $("deleteArea").hidden=site.category!=="saved";
 if(site.category!=="saved"){
   const request=++fetchId;
   try{await refreshPublished(site,request)}catch(e){
     if(request===fetchId)$("imageNote").textContent="Processed imagery unavailable: "+e.message;
   }
 }else{
   ++fetchId;
   $("imageNote").textContent="Select one or two dates from Satellite observation history below. Only the selected real scenes will be displayed.";
 }
 await refreshCatalog();
}

function setSlider(percentage){
 const value=Math.max(0,Math.min(100,Number(percentage)||0));
 $("overlayAfterImage").style.clipPath=clipValue(value);
 $("overlayDivider").style.left=value+"%";
 $("compareSlider").value=String(value);
}
function setViewMode(mode){
 compareMode=mode==="side"?"side":"overlay";
 const paired=chosenSceneIds.length===2&&!$("selectedTools").hidden;
 $("viewModes").hidden=!paired;
 $("viewOverlay").setAttribute("aria-pressed",String(compareMode==="overlay"));
 $("viewSide").setAttribute("aria-pressed",String(compareMode==="side"));
 if(paired){
   $("overlay").hidden=compareMode!=="overlay";
   $("pair").hidden=compareMode!=="side";
 }
}
function resetSelectedView(){
 if(activePreview)activePreview.aborted=true;
 activePreview=null;
 $("singleScene").hidden=true;
 $("overlay").hidden=true;
 $("selectedTools").hidden=true;
 $("viewModes").hidden=true;
 $("pair").hidden=true;
 $("recentSummary").textContent="";
 if(selected?.category==="registered"&&selected?.path){
   const request=fetchId;
   refreshPublished(selected,request).catch(err=>{
     if(request===fetchId)$("imageNote").textContent=
       "Default processed image pair unavailable: "+err.message;
   });
 }else{
   $("imageNote").textContent="Select one or two observations below to show the exact satellite images.";
 }
}
function sceneRole(scene){
 const matched=chosenSceneIds.map(id=>catalogScenes.find(x=>x.id===id)).filter(Boolean);
 if(!chosenSceneIds.includes(scene.id))return null;
 if(matched.length===1)return "Selected";
 const sorted=orderedScenes(matched);
 return scene.id===sorted[0]?.id?"BEFORE":"AFTER";
}
function renderSceneCards(){
 const root=$("observations");
 root.replaceChildren();
 if(!catalogScenes.length){
   root.append(makeElement("p",
     "No acquisition dates found in this period. Try a longer time range; absence of imagery does not mean no ground changes.",
     "muted"));
 }else for(const scene of catalogScenes){
   const button=makeElement("button",null,
     "obs-item"+(chosenSceneIds.includes(scene.id)?" is-selected":""));
   button.type="button";
   const src=catalogById.get(scene.id);
   const hasVisual=Boolean(src?.assets?.visual?.href?.startsWith("https://"));
   button.disabled=!hasVisual;
   button.setAttribute("aria-pressed",String(chosenSceneIds.includes(scene.id)));
   button.setAttribute("aria-label",scene.date+" · "+(scene.cloud_percent===null?
     "unknown scene cloud cover":scene.cloud_percent+"% whole-scene cloud cover")+
     (hasVisual?" · select observation":" · no original image available"));
   button.append(makeElement("strong",scene.date));
   button.append(makeElement("span",scene.cloud_percent===null?
      "Cloud cover unknown (whole scene)":
      scene.cloud_percent+"% cloud cover (whole scene, not this area)"));
   const label=sceneRole(scene);
   if(label)button.append(makeElement("span",label+" · click to deselect","selection-role"));
   else if(!hasVisual)button.append(makeElement("span","Original visual image unavailable","selection-role"));
   button.onclick=()=>selectSceneId(scene.id);
   root.append(button);
 }
 const picked=orderedScenes(chosenSceneIds.map(id=>catalogScenes.find(x=>x.id===id)).filter(Boolean));
 $("selectedStatus").textContent=picked.length===0?
   "No dates selected · click one or two dates to inspect":
   (picked.length===1?
     "1 date selected: "+picked[0].date+" · click a second date to compare":
     "2 dates selected: "+picked[0].date+" (BEFORE) → "+picked[1].date+
       " (AFTER) · click a third date to replace the earliest selected");
}
function selectSceneId(id){
 if(!catalogById.has(id))return;
 const item=catalogById.get(id);
 if(!item?.assets?.visual?.href?.startsWith("https://"))return;
 chosenSceneIds=toggleSceneIds(chosenSceneIds,id);
 renderSceneCards();
 if(!chosenSceneIds.length){resetSelectedView();return;}
 renderExactScenes();
}
async function renderExactScenes(){
 if(!selected||!chosenSceneIds.length)return;
 if(activePreview)activePreview.aborted=true;
 const token={aborted:false};
 activePreview=token;
 const currentArea=selected;
 const sceneItems=chosenSceneIds.map(id=>catalogById.get(id)).filter(Boolean);
 if(sceneItems.length!==chosenSceneIds.length){
   $("imageNote").textContent="Some selected scenes were no longer in the current catalog. Refresh and reselect.";
   return;
 }
 $("selectedTools").hidden=false;
 $("viewModes").hidden=true;
 $("singleScene").hidden=true;
 $("overlay").hidden=true;
 $("pair").hidden=true;
 $("recentSummary").textContent="Loading the selected original Sentinel-2 pixels…";
 $("imageNote").textContent="Displaying only the exact acquisition(s) you selected; there is no substitute date.";
 $("chosenDates").textContent=orderedScenes(sceneItems.map(x=>({date:x.properties.datetime.slice(0,10)})))
    .map(x=>x.date).join(" → ");
 if(!global.InfraCustomPreview){
   $("recentSummary").textContent="Satellite viewer failed to load.";
   $("imageNote").textContent="Try reloading the page. No other scene was substituted.";
   return;
 }
 try{
   const result=await global.InfraCustomPreview.renderSelected(currentArea,sceneItems,{
     signal:token,cache:previewCache,
     onProgress:message=>{
       if(!token.aborted&&selected?.id===currentArea.id)
         $("recentSummary").textContent=message;
     }
   });
   if(token.aborted||selected?.id!==currentArea.id)return;
   const [before,after]=result.scenes;
   $("selectedTools").hidden=false;
   if(result.count===1){
     $("singleImage").src=before.image;
     $("singleDate").textContent=before.date+
       " · scene "+before.id;
     $("singleScene").hidden=false;
     $("viewModes").hidden=true;
     $("recentSummary").textContent="One exact Sentinel-2 image · "+before.date;
   }else{
     $("beforeImage").src=before.image;
     $("afterImage").src=after.image;
     $("beforeDate").textContent="BEFORE · "+before.date;
     $("afterDate").textContent="AFTER · "+after.date;
     $("overlayBeforeImage").src=before.image;
     $("overlayAfterImage").src=after.image;
     $("overlayDateBefore").textContent="BEFORE · "+before.date;
     $("overlayDateAfter").textContent="AFTER · "+after.date;
     $("viewModes").hidden=false;
     setSlider(50);
     setViewMode(compareMode);
     $("recentSummary").textContent="Exact selected images · "+before.date+
       " → "+after.date+" · geographically aligned 2 × 2 km crops";
   }
   $("imageNote").textContent=result.note+
     " Both images cover the same geographical square; changes and cloud artifacts require interpretation.";
   say("Selected Sentinel images loaded. No automatic interpretation or fabricated observation.");
   if(result.count===2)$("comparisonSection").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(err){
   if(token.aborted||selected?.id!==currentArea.id)return;
   $("singleScene").hidden=true;
   $("overlay").hidden=true;$("pair").hidden=true;
   $("recentSummary").textContent="Could not display the selected observation(s).";
   $("imageNote").textContent=err.message+
      " The original selection remains highlighted; no alternative dates were used.";
   say("A selected image could not be rendered. See the precise error under Recent satellite comparison.");
 }
}
async function refreshCatalog(){
 if(!selected)return;
 if(activePreview)activePreview.aborted=true;
 const request=++fetchId;
 const area=selected;
 const days=Number($("timeRange").value);
 $("observations").replaceChildren(makeElement("div","Checking public Sentinel-2 catalog…","muted"));
 $("checkedAt").textContent="Checking now";
 try{
   const response=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(searchBody(area,days))});
   if(!response.ok)throw Error("Catalog HTTP "+response.status);
   const data=await response.json();
   if(request!==fetchId||selected?.id!==area.id)return;
   catalogScenes=parseScenes(data,days);
   catalogById=new Map((Array.isArray(data.features)?data.features:[])
     .filter(x=>typeof x?.id==="string").map(x=>[x.id,x]));
   const available=new Set(catalogScenes.map(x=>x.id));
   chosenSceneIds=chosenSceneIds.filter(id=>available.has(id));
   renderSceneCards();
   $("checkedAt").textContent="Catalog checked "+new Date().toLocaleString()+
     " · "+catalogScenes.length+" unique dates shown";
   say("Click one or two dates to load those exact Sentinel-2 images. Cloud percentages are whole-scene estimates.");
   if(chosenSceneIds.length)renderExactScenes();
   else if(area.category==="saved")resetSelectedView();
 }catch(err){
   if(request!==fetchId)return;
   catalogScenes=[];catalogById=new Map();
   $("observations").replaceChildren(makeElement("p",
      "Live catalog unavailable: "+err.message+
      ". Refresh to retry. Saved areas remain on this browser.","muted"));
   $("checkedAt").textContent="Check failed";
   $("selectedStatus").textContent="No dates available · catalog could not be reached";
   say("Satellite scene catalog unavailable; no observations have been invented.");
 }
}
function addArea(){
 if(!selection){say("Click a location on the map to choose a study area.");return;}
 const name=$("areaName").value.trim();
 if(name.length<2||name.length>60){say("Enter a name between 2 and 60 characters.");return;}
 if(customs.length>=50){say("Maximum 50 local areas reached.");return;}
 const item={id:"custom-"+Date.now(),name,
   lat:selection.lat,lon:selection.lon,type:$("areaType").value,
   size_km:2,category:"saved",status:"metadata_only"};
 if(!validCustom(item)){say("Invalid area. Please choose another location.");return;}
 customs.push(item);sites.push(item);save();
 $("areaName").value="";selection=null;
 say("Area saved locally. InfraTrack will attempt an on-demand real satellite comparison.");
 choose(item);
}
function deleteArea(){
 if(selected?.category!=="saved")return;
 const id=selected.id;
 customs=customs.filter(x=>x.id!==id);
 sites=sites.filter(x=>x.id!==id);
 save();
 const remaining=sites[0];
 if(remaining)choose(remaining);
 else {$("selectionName").textContent="No areas configured";renderSites();}
 say("Local area removed.");
}
async function init(){
 try{customs=readSaved(localStorage).map(x=>({...x,category:"saved",status:"metadata_only"}))}
 catch{customs=[];}
 makeMap();
 try{
  const response=await fetch("projects.json",{cache:"no-store"});
  if(!response.ok)throw Error("Area registry unavailable");
  manifest=await response.json();
  sites=(manifest.sites||[]).map(x=>({...x,category:"registered"})).concat(customs);
 }catch{sites=customs.slice();say("Registered area catalog unavailable. Saved areas still work.");}
 renderSites();
 const query=new URLSearchParams(location.search).get("site");
 const first=sites.find(x=>x.id===query)||sites[0];
 if(first)await choose(first);
 else $("selectionName").textContent="Choose a 2 km study area on the map";
 $("saveArea").onclick=addArea;
 $("deleteArea").onclick=deleteArea;
 $("refresh").onclick=refreshCatalog;
 $("clearComparison").onclick=()=>{chosenSceneIds=[];renderSceneCards();resetSelectedView();};
 $("viewOverlay").onclick=()=>setViewMode("overlay");
 $("viewSide").onclick=()=>setViewMode("side");
 $("compareSlider").oninput=next=>setSlider(next.target.value);
 $("timeRange").onchange=refreshCatalog;
 $("pickArea").onclick=()=>{
    say("Click anywhere on the map within Europe, then name and save that 2 × 2 km square.");
    if(map)map.setView([49.5,15],5);
 };
 // Periodic check only while this browser page is open — NOT background monitoring.
 setInterval(()=>{if(document.visibilityState==="visible"&&selected)refreshCatalog();},60*60*1000);
}
init();
global.InfraMonitorCore=core;
})(typeof window!=="undefined"?window:globalThis);
