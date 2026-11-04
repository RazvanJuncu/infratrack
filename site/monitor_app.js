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
const core={STORE,allowed,bounds,validCustom,readSaved,dateBounds,searchBody,parseScenes};
if(typeof module==="object"&&module.exports)module.exports=core;
if(!global.document)return;
const $=id=>document.getElementById(id);
let sites=[],customs=[],selected=null,selection=null,map=null,pin=null,rect=null;
let fetchId=0,manifest=null,visibility="ready";
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
      "My area · live acquisition dates":(site.status==="ready"?"Processed imagery":"No processed imagery"));
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
 selected=site;renderSites();
 $("selectionName").textContent=site.name;
 $("selectionKind").textContent=site.category==="saved"?
  "My saved area · 2 km study square":"Registered research area · 2 km study square";
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
   $("imageNote").textContent="Custom areas currently support fresh Sentinel acquisition monitoring. Automatic image crops/change detection are available only for registered processed areas.";
 }
 await refreshCatalog();
}
async function refreshCatalog(){
 if(!selected)return;
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
   const scenes=parseScenes(data,days);
   $("observations").replaceChildren();
   if(!scenes.length){
     $("observations").append(makeElement("p","No catalog acquisitions found in this period. This is not evidence that the ground was unchanged.","muted"));
   }else{
     for(const scene of scenes){
       const item=makeElement("div",null,"obs-item");
       item.append(makeElement("strong",scene.date));
       item.append(makeElement("span",scene.cloud_percent===null?
         "Scene cloud cover unknown":
         scene.cloud_percent+"% cloud cover (whole scene, not this area)"));
       $("observations").append(item);
     }
   }
   $("checkedAt").textContent="Catalog checked "+new Date().toLocaleString()+
     " · "+scenes.length+" unique dates shown";
   say("Observations are real catalog acquisitions, not locally cloud-checked images or detected change.");
 }catch(e){
   if(request!==fetchId)return;
   $("observations").replaceChildren(makeElement("p",
      "Live catalog unavailable: "+e.message+
      ". You can retry. Saved areas remain on this browser.","muted"));
   $("checkedAt").textContent="Check failed";
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
 say("Area saved locally. Latest Sentinel acquisitions will be checked whenever you open or refresh Monitor.");
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
