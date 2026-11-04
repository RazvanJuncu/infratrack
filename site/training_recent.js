/* InfraTrack recent change Q&A: research annotations, never ground truth. */
(function(global){
"use strict";
const STORE="infratrack:recent-training:v1:";
const LABELS=["construction","agriculture","vegetation","other","no_change","unsure"];
const CONFIDENCE=["high","medium","low"];
function validRecord(r,item){
 return r&&r.item_id===item.id&&r.study_id===item.study_id&&
 r.signature===item.signature&&LABELS.includes(r.label)&&
 (r.label==="unsure"||CONFIDENCE.includes(r.confidence))&&
 r.status==="unverified_visual_review"&&r.training_eligible===false;
}
function key(item){return STORE+item.study_id+":"+item.signature+":"+item.id;}
function loadDraft(storage,item) {
 try{
  const raw=storage?.getItem(key(item));
  if(!raw)return null;
  const data=JSON.parse(raw);
  return validRecord(data,item)?data:null;
 }catch{return null;}
}
function exportDrafts(items,storage){
 const entries=items.map(x=>loadDraft(storage,x)).filter(Boolean);
 return {"type":"recent_change_visual_reviews","question_version":"recent-change-questions-v1",
         "eligible_for_training":false,"verified_count":0,
         "source":"Real recent Sentinel-2 scene pairs",
         "warning":"Provisional visual interpretations only. Not independent evidence and never eligible for model training.",
         "items":entries};
}
function nextUnreviewed(items,storage,from) {
 for(let step=1;step<=items.length;step++){
   const i=(from+step)%items.length;
   if(!loadDraft(storage,items[i]))return i;
 }
 return -1;
}
const core={STORE,LABELS,CONFIDENCE,validRecord,key,loadDraft,exportDrafts,nextUnreviewed};
if(typeof module==="object"&&module.exports)module.exports=core;
if(!global.document)return;
const $=id=>document.getElementById(id);
let items=[],filtered=[],index=0,pending=null,storage=null,imageCache=new Map(),history=[],areas=[];
let filterArea="all",message="";
try{storage=global.localStorage}catch{storage=null}
function note(text){$("quizStatus").textContent=text}
function progress(){
 const done=filtered.reduce((n,item)=>n+Boolean(loadDraft(storage,item)),0);
 $("reviewProgress").textContent=done+" / "+filtered.length+" reviewed";
 $("progressBar").style.width=filtered.length?(done/filtered.length*100)+"%":"0%";
}
function crop(id,image,item){
 const canvas=$(id),ctx=canvas.getContext("2d");
 if(!ctx)return;
 ctx.clearRect(0,0,canvas.width,canvas.height);
 if(!image.complete||!image.naturalWidth){
   ctx.fillStyle="#1a3440";ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.fillStyle="#b9c9d4";ctx.font="13px system-ui";
   ctx.fillText("Loading satellite image…",14,25);
   return;
 }
 const span=48;
 const sx=Math.max(0,Math.min(image.naturalWidth-span,item.col-span/2));
 const sy=Math.max(0,Math.min(image.naturalHeight-span,item.row-span/2));
 ctx.imageSmoothingEnabled=false;
 ctx.drawImage(image,sx,sy,span,span,0,0,canvas.width,canvas.height);
 const px=(item.col+.5-sx)/span*canvas.width;
 const py=(item.row+.5-sy)/span*canvas.height;
 ctx.strokeStyle="#fff";ctx.lineWidth=2.5;
 ctx.strokeRect(px-canvas.width/span/2,py-canvas.height/span/2,
                canvas.width/span,canvas.height/span);
 ctx.strokeStyle="#ffbf59";ctx.lineWidth=1.3;ctx.beginPath();
 ctx.moveTo(px-13,py);ctx.lineTo(px-5,py);
 ctx.moveTo(px+5,py);ctx.lineTo(px+13,py);
 ctx.moveTo(px,py-13);ctx.lineTo(px,py-5);
 ctx.moveTo(px,py+5);ctx.lineTo(px,py+13);ctx.stroke();
}
function imgsFor(item){
 const source=item.study_id+":"+item.signature;
 if(!imageCache.has(source)){
   const before=new Image(),after=new Image();
   const folder=item.folder;
   before.src=folder+"recent_before.png";after.src=folder+"recent_after.png";
   before.onload=after.onload=()=>{if(current()?.study_id===item.study_id)draw()};
   before.onerror=after.onerror=()=>{if(current()?.study_id===item.study_id)note("A recent image preview failed to load. Review skipped until imagery is available.")};
   imageCache.set(source,[before,after]);
 }
 return imageCache.get(source);
}
function current(){return filtered[index]||null;}
function draw(){
 const item=current();
 if(!item)return;
 const [before,after]=imgsFor(item);
 crop("beforeCanvas",before,item);
 crop("afterCanvas",after,item);
}
function showQuestion(stage) {
 $("questionOne").hidden=stage!==1;
 $("questionTwo").hidden=stage!==2;
 if(stage===2)$("chosenResponse").textContent=
   ({construction:"Construction activity",agriculture:"Farming/seasonal",
    vegetation:"Vegetation/land disturbance",other:"Other change",
    no_change:"No meaningful change"})[pending]||"—";
}
function render(){
 progress();
 const item=current();
 $("undo").disabled=history.length===0;
 $("prev").disabled=!filtered.length;
 $("next").disabled=!filtered.length;
 $("exportQuiz").disabled=!items.some(x=>loadDraft(storage,x));
 if(!item){
   $("scenarioTitle").textContent="No recent significant-change candidates";
   $("scenarioMeta").textContent="No synthetic examples are generated. Choose another location or check again after new clear Sentinel observations.";
   $("questionOne").hidden=true;$("questionTwo").hidden=true;
   note(message||"No qualifying real imagery. This is not proof of no change.");
   return;
 }
 const saved=loadDraft(storage,item);
 $("scenarioTitle").textContent=item.name+" · example "+(index+1)+" / "+filtered.length;
 $("scenarioMeta").textContent=item.before_date+" → "+item.after_date+
   " · "+item.study_id+" · score "+item.signal_strength+
   " (unverified spectral difference)";
 $("reviewState").textContent=saved?
  "Already reviewed: "+saved.label.replaceAll("_"," ")+
   " · "+(saved.confidence||"unsure"):"Not reviewed yet";
 const url="https://www.openstreetmap.org/?mlat="+item.lat+"&mlon="+item.lon+
   "#map=17/"+item.lat+"/"+item.lon;
 $("exactLocation").href=url;
 $("beforeDate").textContent="BEFORE · "+item.before_date;
 $("afterDate").textContent="AFTER · "+item.after_date;
 if(!pending)showQuestion(1);
 else showQuestion(2);
 draw();
 note(message||"Inspect the same area at two recent dates; classify the CHANGE, not the land type.");
}
function choose(i){
 if(!filtered.length)return;
 index=(i+filtered.length)%filtered.length;
 pending=null;message="";
 render();
}
function commit(label,confidence){
 const item=current();if(!item)return;
 if(!LABELS.includes(label))return;
 if(label!=="unsure"&&!CONFIDENCE.includes(confidence))return;
 const record={item_id:item.id,study_id:item.study_id,signature:item.signature,
               lat:item.lat,lon:item.lon,row:item.row,col:item.col,
               before_date:item.before_date,after_date:item.after_date,
               label,confidence:label==="unsure"?null:confidence,
               question_version:"recent-change-questions-v1",
               status:"unverified_visual_review",training_eligible:false,
               evidence_url:null,annotated_at:new Date().toISOString()};
 const previous=loadDraft(storage,item);
 history.push({item,previous,index});
 if(storage){try{storage.setItem(key(item),JSON.stringify(record))}
    catch{note("Storage blocked — review won't survive refresh.")}}
 const next=nextUnreviewed(filtered,storage,index);
 message="Saved provisional answer. It does not train the model.";
 pending=null;
 if(next>=0)index=next;
 render();
}
function undo(){
 const entry=history.pop();if(!entry)return;
 try{
  if(entry.previous)storage?.setItem(key(entry.item),JSON.stringify(entry.previous));
  else storage?.removeItem(key(entry.item));
 }catch{}
 const where=filtered.findIndex(x=>x.id===entry.item.id);
 if(where>=0)index=where;
 pending=null;message="Last answer undone.";render();
}
function filter(site){
 filterArea=site;
 filtered=items.filter(x=>site==="all"||x.study_id===site);
 index=0;pending=null;message="";
 const first=nextUnreviewed(filtered,storage,-1);
 if(first>=0)index=first;
 render();
}
function exportAll(){
 const payload=exportDrafts(items,storage);
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
 const u=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=u;
 a.download="infratrack-recent-change-reviews.json";
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),1000);
 message="Backup exported; these are not verified training labels.";render();
}
async function start(){
 $("prev").onclick=()=>choose(index-1);
 $("next").onclick=()=>choose(index+1);
 $("undo").onclick=undo;
 $("exportQuiz").onclick=exportAll;
 $("skip").onclick=()=>commit("unsure",null);
 $("backToOne").onclick=()=>{pending=null;showQuestion(1)};
 for(const button of document.querySelectorAll("[data-label]")){
   button.onclick=()=>{
     const label=button.dataset.label;
     if(!LABELS.includes(label))return;
     if(label==="unsure"){commit("unsure",null);return;}
     pending=label;message="";render();
   };
 }
 for(const button of document.querySelectorAll("[data-confidence]")){
   button.onclick=()=>{if(pending)commit(pending,button.dataset.confidence)};
 }
 try{
   const response=await fetch("recent_manifest.json",{cache:"no-store"});
   if(!response.ok)throw Error("Recent change manifest missing");
   const catalog=await response.json();
   const ready=(catalog.sites||[]).filter(x=>x.status==="ready"&&x.candidate_count>0);
   areas=ready;
   const loaded=await Promise.all(ready.map(async site=>{
      const folder="projects/"+site.id+"/";
      const response=await fetch(folder+"recent_queue.json",{cache:"no-store"});
      if(!response.ok)return [];
      const queue=await response.json();
      if(queue.status!=="unverified_recent_changes"||
         !Array.isArray(queue.items)||!queue.scene_signature)return [];
      return queue.items.map(item=>({...item,study_id:site.id,name:site.name,
         signature:queue.scene_signature,folder}));
   }));
   items=loaded.flat().sort((a,b)=>b.signal_strength-a.signal_strength);
   const select=$("regionSelect");
   select.replaceChildren();
   let option=document.createElement("option");
   option.value="all";option.textContent="All available locations";select.append(option);
   for(const site of ready){
      option=document.createElement("option");
      option.value=site.id;option.textContent=site.name;select.append(option);
   }
   select.onchange=()=>filter(select.value);
   const requested=new URLSearchParams(location.search).get("site");
   const match=ready.find(x=>x.id===requested);
   if(match)select.value=match.id;
   filter(match?match.id:"all");
   $("sourceSummary").textContent=items.length+" real significant-change candidates from "+
    ready.length+" processed areas. Every answer is provisional.";
 }catch(err){message="Recent source data unavailable: "+err.message;render();}
}
start();
global.InfraRecentTrainingCore=core;
})(typeof window!=="undefined"?window:globalThis);
