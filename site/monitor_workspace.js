/*
 * InfraTrack v0.9 Monitor workspace — map > area > scrollable acquisition timeline.
 * Original Sentinel-2 scenes only. No model weights, no fabricated AI prediction.
 */
(function(global){
"use strict";
const core=global.InfraWorkspaceCore;
const preview=global.InfraCustomPreview;
if(!core)throw Error("InfraTrack workspace core missing");
const $=id=>document.getElementById(id);
const STAC="https://earth-search.aws.element84.com/v1/search";
const ICON_DND="application/x-infratrack-scene";
const ICON_SLOT="application/x-infratrack-slot";
const MAX_SCENES=90;
let areas=[],current=null,scenes=[],sceneIndex=new Map();
let slots={before:null,after:null};
let cached=new Map(),inflight=new Map();
let chosenMapPoint=null,leafletMap=null,leafletRect=null;
let catalogSeq=0,viewSeq=0,activeToken=null;
let highlighted=false,loadedPair=null,latestBusy=false;
let lastTap=null;
function status(message){$("canvasStatus").textContent=message}
function notice(message){
 $("recentAlert").hidden=!message;
 $("recentAlert").textContent=message||"";
}
function node(name,txt,cls){
 const n=document.createElement(name);
 if(txt!==undefined)n.textContent=txt;
 if(cls)n.className=cls;
 return n;
}
function saved(){
 try{return core.readSaved(global.localStorage)}
 catch{return []}
}
function persist(list){
 try{global.localStorage.setItem(core.KEY,JSON.stringify(list));return true}
 catch{return false}
}
function renderAreas(){
 $("areas").replaceChildren();
 if(!areas.length){
  $("areas").append(node("p","Add an area to begin","muted small"));return;
 }
 for(const a of areas){
   const button=node("button",undefined,"area"+(current?.id===a.id?" active":""));
   button.type="button";button.append(node("strong",a.name));
   button.append(node("small",a.category==="saved"?"My saved area · Sentinel timeline":
      (a.status==="ready"?"Registered study · processed":"Research area · imagery unavailable")));
   button.onclick=()=>selectArea(a);
   $("areas").append(button);
 }
}
function dayText(item){return core.sceneDate(item)||"Unknown date"}
function cloudText(item){
 const cloud=core.sceneCloud(item);
 return cloud===null?"Unknown cloud cover":Math.round(cloud)+"% clouds · whole scene";
}
function sceneUrl(item){
 return typeof item?.assets?.visual?.href==="string"&&item.assets.visual.href.startsWith("https://");
}
function selectedIds(){return [slots.before,slots.after].filter(Boolean)}
function findScene(id){return sceneIndex.get(id)||null}
function canonicalize(){
 const matches=core.pairFrom(slots,sceneIndex);
 slots={before:matches[0]?.id||null,after:matches[1]?.id||null};
}
function clip(pct) {
 $("canvasNew").style.clipPath=core.sliderClip(pct);
 $("canvasDivider").style.left=pct+"%";
 $("compareRange").value=String(pct);
}
function showEmpty(message){
 $("emptyCanvas").hidden=false;
 $("emptyCanvas").replaceChildren(
   node("strong",message||"Drag a satellite observation"),
   node("span","One image fills the Canvas. Two unlock the Before / After slider.")
 );
 $("canvasOld").hidden=true;
 $("canvasNew").hidden=true;
 $("canvasDivider").hidden=true;
 $("canvasLabels").hidden=true;
 $("compareControls").hidden=true;
 $("changeLayer").hidden=true;
 $("highlightBtn").disabled=true;
 loadedPair=null;
}
function setSlotContent(which,id){
 const wrapper=$(which==="before"?"beforeSlotContent":"afterSlotContent");
 const remove=$(which==="before"?"removeBefore":"removeAfter");
 wrapper.replaceChildren();
 const title=which==="before"?"BEFORE":"AFTER";
 const item=id?findScene(id):null;
 if(!item){
   wrapper.append(node("strong",title),node("small","Drop an image here"));
   remove.hidden=true;
   wrapper.draggable=false;
   return;
 }
 const handle=node("div",undefined,"handle");
 handle.append(node("strong",title+" · "+dayText(item)));
 handle.append(node("small",cloudText(item)+" · drag to remove"));
 handle.title="Drag this image to the remove area at the end of the timeline";
 handle.draggable=true;
 handle.addEventListener("dragstart",event=>{
   if(!event.dataTransfer)return;
   event.dataTransfer.effectAllowed="move";
   event.dataTransfer.setData(ICON_SLOT,JSON.stringify({
      type:"infratrack-slot",slot:which,id,areaId:current?.id
   }));
   event.dataTransfer.setData("text/plain",id);
 });
 wrapper.append(handle);
 remove.hidden=false;
}
function renderSlots(){
 canonicalize();
 setSlotContent("before",slots.before);
 setSlotContent("after",slots.after);
}
function renderTimeline(){
 const box=$("timelineScroll");
 box.replaceChildren();
 if(!scenes.length){
  box.append(node("p","No source acquisitions in this date window. Try a longer range.","muted small"));
  return;
 }
 for(const scene of scenes){
  const chosen=selectedIds().includes(scene.id);
  const card=node("button",undefined,"scene-card"+(chosen?" chosen":""));
  card.type="button";card.draggable=true;
  card.title="Drag to either Canvas slot, or click to add";
  const cacheKey=current?.id+":"+scene.id;
  const image=cached.get(cacheKey);
  const originalTileThumbnail=scene.assets?.thumbnail?.href;
  const tilePreview=typeof originalTileThumbnail==="string"&&
    originalTileThumbnail.startsWith("https://")?originalTileThumbnail:null;
  if(image?.image||tilePreview){
    const t=node("img",undefined,"thumb");
    t.src=image?.image||tilePreview;
    t.alt=image?.image?"Crop of this 2 km study square":
       "Thumbnail of the whole satellite tile, not this selected square";
    t.title=t.alt;
    t.loading="lazy";
    card.append(t);
  }
  card.append(node("div",dayText(scene),"day"));
  const cloud=node("div",cloudText(scene),"cloud");
  if(core.sceneCloud(scene)>=70)cloud.classList.add("bad");
  card.append(cloud);
  if(!sceneUrl(scene))card.append(node("div","RGB image asset missing","role"));
  if(chosen)card.append(node("div",core.pairFrom(slots,sceneIndex).findIndex(s=>s.id===scene.id)===0?
     "IN CANVAS · BEFORE":"IN CANVAS · AFTER","role"));
  card.setAttribute("aria-pressed",String(chosen));
  card.addEventListener("click",()=>{
    if(!current)return;
    const now=Date.now();
    if(lastTap&&lastTap.id===scene.id&&now-lastTap.at<550)return;
    lastTap={id:scene.id,at:now};
    if(chosen){
      if(slots.before===scene.id)slots.before=null;
      if(slots.after===scene.id)slots.after=null;
      updateCanvas();
    }else{
      slots=core.addByClick(slots,scene.id);
      updateCanvas();
    }
  });
  card.addEventListener("dragstart",event=>{
    if(!event.dataTransfer)return;
    event.dataTransfer.effectAllowed="copy";
    event.dataTransfer.setData(ICON_DND,core.payload(scene.id,current.id));
    event.dataTransfer.setData("text/plain",scene.id);
  });
  box.append(card);
 }
}
function cancelView(){
 viewSeq++;
 if(activeToken)activeToken.aborted=true;
 activeToken=null;
 loadedPair=null;
}
function readDrop(event){
 let id=core.parsePayload(event.dataTransfer?.getData(ICON_DND),current?.id);
 if(id&&sceneIndex.has(id))return id;
 try{
   const v=JSON.parse(event.dataTransfer?.getData(ICON_SLOT)||"null");
   if(v?.type==="infratrack-slot"&&v.areaId===current?.id&&
      sceneIndex.has(v.id))return v.id;
 }catch{}
 return null;
}
function readDraggedSlot(event){
 try{
   const v=JSON.parse(event.dataTransfer?.getData(ICON_SLOT)||"null");
   return v?.type==="infratrack-slot"&&v.areaId===current?.id&&
     ["before","after"].includes(v.slot)?v.slot:null;
 }catch{return null}
}
function assignDrop(event,slot){
 event.preventDefault();event.currentTarget.classList.remove("over","drag-over");
 const id=readDrop(event);
 if(!id)return;
 slots=core.dropInto(slots,slot,id);
 updateCanvas();
}
function removeSlot(which){
 slots=core.removeFrom(slots,which);
 updateCanvas();
}
function attachDrops(){
 for(const which of ["before","after"]){
   const el=$(which==="before"?"slotBefore":"slotAfter");
   el.addEventListener("dragover",e=>{e.preventDefault();el.classList.add("over")});
   el.addEventListener("dragleave",()=>el.classList.remove("over"));
   el.addEventListener("drop",e=>assignDrop(e,which));
 }
 const viewport=$("canvasViewport");
 viewport.addEventListener("dragover",e=>{e.preventDefault();viewport.classList.add("drag-over")});
 viewport.addEventListener("dragleave",()=>viewport.classList.remove("drag-over"));
 viewport.addEventListener("drop",e=>{
   const box=viewport.getBoundingClientRect();
   const half=e.clientX<box.left+box.width/2?"before":"after";
   assignDrop(e,half);
 });
 for(const id of ["canvasOld","canvasNew"]){
   const image=$(id);
   image.draggable=true;
   image.addEventListener("dragstart",e=>{
     const slot=id==="canvasOld"?"before":"after";
     const source=id==="canvasOld"?slots.before:slots.after;
     if(!source||!e.dataTransfer)return;
     e.dataTransfer.setData(ICON_SLOT,JSON.stringify({
       type:"infratrack-slot",slot,id:source,areaId:current?.id
     }));
     e.dataTransfer.effectAllowed="move";
   });
 }
 const trash=$("removeDrop");
 trash.addEventListener("dragover",e=>{e.preventDefault();trash.classList.add("over")});
 trash.addEventListener("dragleave",()=>trash.classList.remove("over"));
 trash.addEventListener("drop",e=>{
   e.preventDefault();trash.classList.remove("over");
   const source=readDraggedSlot(e);
   if(source)removeSlot(source);
 });
 const timeline=$("timelineScroll");
 timeline.addEventListener("dragover",e=>{
   if(e.dataTransfer?.types?.includes(ICON_SLOT))e.preventDefault();
 });
 timeline.addEventListener("drop",e=>{
   const source=readDraggedSlot(e);
   if(source){e.preventDefault();removeSlot(source)}
 });
 $("removeBefore").onclick=()=>removeSlot("before");
 $("removeAfter").onclick=()=>removeSlot("after");
 $("clearCanvas").onclick=()=>{
   slots={before:null,after:null};
   updateCanvas();
 };
 $("compareRange").addEventListener("input",e=>clip(Number(e.target.value)));
 $("highlightBtn").onclick=()=>{
   highlighted=!highlighted;
   $("highlightBtn").setAttribute("aria-pressed",String(highlighted));
   applyHighlight();
 };
}
async function cropScene(item,token,allowCloudy=true){
 if(!current||!item)throw Error("Missing area or original satellite acquisition");
 const key=current.id+":"+item.id;
 if(cached.has(key))return cached.get(key);
 if(!preview)throw Error("Sentinel viewer did not load");
 const result=await preview.renderSelected(current,[item],{
    signal:token,allowCloudy,requireLocalScreening:!allowCloudy,
    minClear:.65
 });
 if(token?.aborted)throw Error("Cancelled");
 const img=result.scenes[0];
 if(!img)throw Error("No exact original scene crop returned");
 cached.set(key,img);
 while(cached.size>16)cached.delete(cached.keys().next().value);
 renderTimeline();
 return img;
}
function applyHighlight(){
 const button=$("highlightBtn"),layer=$("changeLayer");
 button.disabled=!(loadedPair&&loadedPair.length===2);
 if(!highlighted||!loadedPair||loadedPair.length!==2){
   layer.hidden=true;
   $("changeSummary").textContent="Experimental visual difference, not AI classification.";
   return;
 }
 try{
   const [before,after]=loadedPair;
   const diff=core.rgbDifference(before.rgba,after.rgba,48);
   layer.width=before.width;layer.height=before.height;
   const ctx=layer.getContext("2d");
   if(!ctx)throw Error("Canvas rendering unavailable");
   const bitmap=ctx.createImageData(layer.width,layer.height);
   bitmap.data.set(diff.rgba);ctx.putImageData(bitmap,0,0);
   layer.hidden=false;
   $("changeSummary").textContent=diff.percent===null?
     "Insufficient comparable RGB pixels":
     diff.percent+"% of valid RGB pixels exceed the experimental visual threshold. "+
       "This is NOT trained AI: crops, clouds, lighting and seasonal changes can be highlighted.";
 }catch(err){
   layer.hidden=true;
   $("changeSummary").textContent="Difference overlay unavailable: "+err.message;
 }
}
async function updateCanvas(){
 cancelView();
 renderSlots();renderTimeline();
 const matched=core.pairFrom(slots,sceneIndex);
 $("canvasLabels").hidden=true;
 $("changeLayer").hidden=true;
 $("compareControls").hidden=true;
 $("highlightBtn").disabled=true;
 $("canvasOld").hidden=true;$("canvasNew").hidden=true;
 $("canvasDivider").hidden=true;
 if(!matched.length){
   showEmpty();
   status("Canvas empty. Drag one or two scenes from the timeline.");
   return;
 }
 const token={aborted:false};
 activeToken=token;
 const request=++viewSeq;
 $("emptyCanvas").hidden=false;
 $("emptyCanvas").replaceChildren(node("strong","Loading "+matched.length+" actual Sentinel observation"+(matched.length===1?"":"s")+"…"),
   node("span","Scenes are read from original Sentinel-2 GeoTIFF files."));
 status("Loading "+matched.map(dayText).join(" and ")+"…");
 const results=await Promise.allSettled(matched.map(x=>cropScene(x,token,true)));
 if(token.aborted||request!==viewSeq)return;
 const success=results.map((r,i)=>({r,item:matched[i]})).filter(x=>x.r.status==="fulfilled");
 const failure=results.map((r,i)=>({r,item:matched[i]})).filter(x=>x.r.status==="rejected");
 if(!success.length){
   showEmpty("Could not load the selected original satellite image");
   status(failure.map(x=>dayText(x.item)+": "+x.r.reason.message).join(" | "));
   return;
 }
 $("emptyCanvas").hidden=true;
 const first=success[0].r.value;
 $("canvasOld").src=first.image;
 $("canvasOld").hidden=false;
 $("labelOld").textContent=matched.length===1?dayText(success[0].item):
   "BEFORE · "+dayText(success[0].item);
 $("labelNew").textContent="";
 $("canvasLabels").hidden=false;
 $("canvasNew").hidden=true;
 if(success.length===2){
   const second=success[1].r.value;
   $("canvasNew").src=second.image;$("canvasNew").hidden=false;
   $("labelOld").textContent="BEFORE · "+first.date;
   $("labelNew").textContent="AFTER · "+second.date;
   $("canvasDivider").hidden=false;
   $("compareControls").hidden=false;
   clip(50);
   loadedPair=[first,second];
   $("highlightBtn").disabled=false;
   applyHighlight();
   status("Comparing "+first.date+" → "+second.date+" · move the slider. "+
       (first.warning||second.warning?"Cloud warning: "+[first.warning,second.warning].filter(Boolean).join("; "):""));
 }else{
   loadedPair=null;
   $("canvasLabels").hidden=false;
   $("canvasDivider").hidden=true;
   $("canvasNew").hidden=true;
   $("highlightBtn").disabled=true;
   $("changeLayer").hidden=true;
   status("Showing "+first.date+" · "+(first.warning||"original Sentinel-2 pixels")+
      (failure.length?" · Other selected image unavailable: "+failure[0].r.reason.message:""));
 }
}
function statusTimeline(txt){$("timelineStatus").textContent=txt}
async function loadCatalog(){
 if(!current)return;
 const ticket=++catalogSeq,site=current;
 cancelView();
 const days=Number($("timeRange").value);
 statusTimeline("Searching Sentinel-2 observations…");
 $("timelineScroll").replaceChildren(node("p","Loading dated acquisitions…","muted small"));
 try{
   const bbox=core.bounds(site);
   const end=new Date(),start=new Date(end.getTime()-days*86400000);
   const body={collections:["sentinel-2-c1-l2a"],bbox,
       datetime:start.toISOString().slice(0,10)+"T00:00:00Z/"+
               end.toISOString().slice(0,10)+"T23:59:59Z",limit:100};
   const res=await fetch(STAC,{method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify(body)});
   if(!res.ok)throw Error("STAC catalog HTTP "+res.status);
   const data=await res.json();
   if(ticket!==catalogSeq||current?.id!==site.id)return;
   scenes=core.catalogScenes(data.features,site,MAX_SCENES);
   sceneIndex=new Map(scenes.map(x=>[x.id,x]));
   const available=new Set(sceneIndex.keys());
   slots.before=available.has(slots.before)?slots.before:null;
   slots.after=available.has(slots.after)?slots.after:null;
   renderTimeline();renderSlots();
   if(selectedIds().length)await updateCanvas();
   statusTimeline(scenes.length+" observations · newest first · scroll to older dates");
   if(!scenes.length)notice("No acquisitions found. Try a longer time interval.");
 }catch(err){
   if(ticket!==catalogSeq||current?.id!==site.id)return;
   scenes=[];sceneIndex=new Map();renderTimeline();
   statusTimeline("Catalog unavailable · use Refresh");
   notice("Cannot load observation timeline: "+err.message+". Existing saved areas are unaffected.");
 }
}
function updateDefault(){
 slots={before:null,after:null};
 cancelView();
 showEmpty();
 renderSlots();renderTimeline();
 status("Choose one or two dated acquisitions, or press See most recent changes.");
}
async function selectArea(area){
 if(!area)return;
 catalogSeq++;cancelView();
 // A previous "most recent" scan may have been cancelled by changing areas.
 // The button must never remain disabled for the newly selected area.
 latestBusy=false;$("latestButton").disabled=false;
 current=area;slots={before:null,after:null};
 scenes=[];sceneIndex=new Map();cached.clear();lastTap=null;
 highlighted=false;$("highlightBtn").setAttribute("aria-pressed","false");
 $("areaTitle").textContent=area.name;
 $("areaDetail").textContent=(area.category==="saved"?"My area":"Research area")+
   " · 2 × 2 km · Copernicus Sentinel-2 · cloud-screened on demand";
 notice("");renderAreas();updateDefault();
 history.replaceState(null,"",location.pathname+"?site="+encodeURIComponent(area.id));
 await loadCatalog();
}
async function mostRecent(){
 if(!current||latestBusy)return;
 if(!scenes.length){
   await loadCatalog();
   if(!scenes.length)return;
 }
 latestBusy=true;$("latestButton").disabled=true;
 const area=current,ticket=++catalogSeq; // Invalidate stale requests, not historical data
 cancelView();
 const token={aborted:false};activeToken=token;
 notice("");
 const candidates=scenes.slice(0,28);
 const kept=[],issues=[];
 try{
   for(const item of candidates){
     if(token.aborted||current?.id!==area.id)return;
     if(kept.length>=2)break;
     const cloud=core.sceneCloud(item);
     if(cloud!==null&&cloud>=85){
       issues.push(dayText(item)+": "+Math.round(cloud)+"% whole-scene cloud (auto-skipped)");
       continue;
     }
     if(!sceneUrl(item)){issues.push(dayText(item)+": no RGB scene asset");continue;}
     status("Finding clear original pixels: "+dayText(item)+"…");
     try{
       const selected=await cropScene(item,token,false);
       if(selected.cloudFraction===null||selected.cloudFraction<.65){
         issues.push(dayText(item)+": could not verify local cloud coverage");
         continue;
       }
       kept.push(item);
     }catch(err){issues.push(dayText(item)+": "+err.message.slice(0,120))}
   }
   if(token.aborted||current?.id!==area.id)return;
   if(kept.length){
     const sorted=core.ordered(kept);
     slots={before:sorted[0].id,after:sorted[1]?.id||null};
     await updateCanvas();
   }
   const cloudWarning=core.cloudAlert(scenes,kept);
   notice((cloudWarning?cloudWarning+" ":"")+
     (kept.length<2?
       "Only "+kept.length+" locally clear observation(s) found in the inspected recent scenes. Try 180 or 365 days. ":
       "Showing the two most recent locally clear observations found. ")+
     (issues.length?"Skipped: "+issues.slice(0,3).join(" · "):""));
   if(!kept.length)status("No locally clear image available among the recent observations checked.");
 }finally{
   if(current?.id===area.id){
     latestBusy=false;$("latestButton").disabled=false;
   }
 }
}
function wireMap(){
 $("openAdd").onclick=()=>{
   $("addDialog").hidden=false;
   if(!global.L){
     $("addStatus").textContent="The interactive map could not be loaded.";return;
   }
   if(!leafletMap){
     leafletMap=L.map("pickMap",{scrollWheelZoom:false}).setView([48,16],5);
     L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
       {maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(leafletMap);
     leafletMap.on("click",e=>{
       if(!core.isAllowed(e.latlng.lat,e.latlng.lng)){
         $("addStatus").textContent="Choose a location within the current European coverage.";return;
       }
       chosenMapPoint={lat:e.latlng.lat,lon:e.latlng.lng};
       const box=core.bounds({...chosenMapPoint,size_km:2});
       if(leafletRect)leafletMap.removeLayer(leafletRect);
       leafletRect=L.rectangle([[box[1],box[0]],[box[3],box[2]]],
          {color:"#67d8c4",weight:2,fillOpacity:.08}).addTo(leafletMap);
       $("pointCoordinates").textContent=
         chosenMapPoint.lat.toFixed(5)+", "+chosenMapPoint.lon.toFixed(5);
       $("addStatus").textContent="Study square selected. Name it and save.";
     });
   }
   setTimeout(()=>leafletMap?.invalidateSize(),0);
 };
 const close=()=>{$("addDialog").hidden=true};
 $("closeAdd").onclick=close;$("cancelAdd").onclick=close;
 $("addDialog").addEventListener("click",e=>{if(e.target===$("addDialog"))close()});
 $("saveArea").onclick=()=>{
   if(!chosenMapPoint){$("addStatus").textContent="Click a location on the map first.";return;}
   const name=$("areaName").value.trim();
   if(name.length<2||name.length>60){
     $("addStatus").textContent="Enter a name (2–60 characters).";return;
   }
   const all=saved();
   if(all.length>=50){$("addStatus").textContent="Maximum 50 locally saved areas.";return;}
   const item={
     id:"custom-"+Date.now()+"-"+Math.floor(Math.random()*999999),
     name,lat:chosenMapPoint.lat,lon:chosenMapPoint.lon,size_km:2,
     type:$("areaType").value,category:"saved",status:"metadata_only"
   };
   if(!core.validSaved(item)){ $("addStatus").textContent="Invalid area settings.";return;}
   if(!persist(all.concat(item))){
     $("addStatus").textContent="Browser storage blocked; the area cannot be retained after refresh.";return;
   }
   areas.push(item);
   chosenMapPoint=null;$("areaName").value="";
   close();selectArea(item);
 };
}
function wire(){
 attachDrops();wireMap();
 $("latestButton").onclick=mostRecent;
 $("refreshTimeline").onclick=loadCatalog;
 $("timeRange").onchange=()=>{slots={before:null,after:null};updateDefault();loadCatalog()};
 document.addEventListener("keydown",e=>{
   if(e.key==="Escape"&&!$("addDialog").hidden)$("addDialog").hidden=true;
 });
}
async function start(){
 wire();
 try{
   const response=await fetch("projects.json",{cache:"no-store"});
   if(!response.ok)throw Error("Study registry unavailable");
   const projects=await response.json();
   areas=(projects.sites||[]).filter(x=>typeof x.id==="string"&&x.id.length<80)
     .map(x=>({...x,category:"registered"})).concat(saved().map(x=>({...x,category:"saved"})));
 }catch(err){
   areas=saved().map(x=>({...x,category:"saved"}));
   notice("Research area registry could not be loaded: "+err.message);
 }
 renderAreas();
 const search=new URLSearchParams(location.search).get("site");
 const chosen=areas.find(x=>x.id===search)||areas[0];
 if(chosen)await selectArea(chosen);
 else status("Add an area on the map to begin monitoring real satellite observations.");
}
start();
})(typeof window!=="undefined"?window:globalThis);
