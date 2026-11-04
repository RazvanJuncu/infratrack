/* InfraTrack Technical v0.8: reads CURRENT published datasets.
   No fake inference, no training from provisional reviews, no untrusted HTML. */
(function (global) {
"use strict";
const $=id=>document.getElementById(id);
const readJSON=async path=>{
 const res=await fetch(path,{cache:"no-store"});
 if(!res.ok)throw Error(path+" · HTTP "+res.status);
 return res.json();
};
const safeId=v=>typeof v==="string"&&/^[a-z0-9-]{3,64}$/.test(v);
const siteFolder=id=>safeId(id)?"projects/"+id+"/":null;
const metric=(value,suffix="")=>
   typeof value==="number"&&Number.isFinite(value)?String(value)+suffix:"—";
const toDay=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value)?
    value.slice(0,10):"—";
function portfolioStats(projects,recent){
 const a=Array.isArray(projects?.sites)?projects.sites:[];
 const b=Array.isArray(recent?.sites)?recent.sites:[];
 const ids=new Set(a.map(x=>x.id).filter(safeId));
 const checked=b.filter(x=>ids.has(x.id));
 return {
  total:a.length,
  processed:a.filter(x=>x.status==="ready").length,
  recent_ready:checked.filter(x=>x.status==="ready").length,
  significant_candidates:checked.filter(x=>x.status==="ready").reduce((n,x)=>n+(Number.isInteger(x.candidate_count)?x.candidate_count:0),0)
 };
}
function safeCandidates(queue,study_id){
 if(queue?.status!=="unverified_recent_changes"||
    queue.study_id!==study_id||!Array.isArray(queue.items))return [];
 return queue.items.filter(p=>Number.isInteger(p.row)&&p.row>=0&&p.row<1000&&
   Number.isInteger(p.col)&&p.col>=0&&p.col<1000&&
   Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&
   Number.isFinite(p.signal_strength)&&
   p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180)
   .sort((a,b)=>b.signal_strength-a.signal_strength);
}
function asPair(site,recent,historical){
 const folder=siteFolder(site.id);
 if(!folder)return null;
 if(recent?.status==="ready"&&
    typeof recent.before_date==="string"&&typeof recent.after_date==="string"){
  return {
   source:"Recent · Sentinel-2",isRecent:true,
   dates:[toDay(recent.before_date),toDay(recent.after_date)],
   images:[folder+"recent_before.png",folder+"recent_after.png"]
  };
 }
 if(historical?.status==="ready"){
  const days=Array.isArray(historical.dates)&&historical.dates.length>=2?
   [historical.dates[0]?.date,historical.dates[1]?.date]:
   [historical.before?.date,historical.after?.date];
  return {
   source:"Historical fallback · NOT current",isRecent:false,
   dates:days.map(toDay),images:[folder+"before.png",folder+"after.png"]
  };
 }
 return null;
}
const core={safeId,siteFolder,metric,toDay,portfolioStats,safeCandidates,asPair};
if(typeof module==="object"&&module.exports)module.exports=core;
if(!global.document)return;
let projects=null,manifest=null,chosen=null,selectionToken=0;
function set(id,value){$(id).textContent=String(value)}
function create(tag,text,cls){
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 if(cls)node.className=cls;
 return node;
}
function link(text,href){
 const node=create("a",text);
 node.href=href;node.target="_blank";node.rel="noopener noreferrer";
 return node;
}
function showFailed(err){
 set("globalStatus","Unable to load current technical data: "+err.message);
 set("techSiteStatus","Unavailable");
}
function setSources(site,recent,queue,historical,validation){
 const box=$("datasetLinks");box.replaceChildren();
 const folder=siteFolder(site.id);
 if(!folder)return;
 const files=[];
 if(recent){files.push(["Recent observations · JSON",folder+"recent.json"]);}
 if(queue){files.push(["Change candidates · JSON",folder+"recent_queue.json"]);}
 if(historical?.status==="ready"){
   files.push(["Historical analysis · JSON",folder+"data.json"],
              ["Spectral features · NPZ",folder+"features_v05.npz"],
              ["Measurements · JSON",folder+"inspection_v05.json"]);
 }
 if(validation){files.push(["ML validation · JSON",folder+"validation_v05.json"]);}
 for(const [name,path] of files){
  const a=link(name,path);a.className="source-link";box.append(a);
 }
 if(!files.length)box.append(create("span","No published source files available","muted"));
}
function renderCandidates(queue,studyId){
 const box=$("candidateList");box.replaceChildren();
 const points=safeCandidates(queue,studyId);
 if(!points.length){
  box.append(create("p","No publishable significant-change locations for this period. This does not mean the ground was unchanged.","muted"));
  return;
 }
 const table=create("table");
 const thead=create("thead");
 const thr=create("tr");
 for(const name of ["Rank","Signal score","10 m pixel","Location"]){
  const th=create("th",name);thr.append(th);
 }
 thead.append(thr);table.append(thead);
 const tbody=create("tbody");
 for(const [i,p] of points.entries()){
  const tr=create("tr");
  tr.append(create("td",String(i+1)));
  tr.append(create("td",metric(p.signal_strength)));
  tr.append(create("td",p.row+", "+p.col));
  const td=create("td");
  const lat=p.lat.toFixed(6),lon=p.lon.toFixed(6);
  td.append(link(lat+", "+lon,
     "https://www.openstreetmap.org/?mlat="+lat+"&mlon="+lon+
     "#map=17/"+lat+"/"+lon));
  tr.append(td);tbody.append(tr);
 }
 table.append(tbody);box.append(table);
}
function renderTimes(data){
 const body=$("sceneList");body.replaceChildren();
 const dates=Array.isArray(data?.dates)?data.dates:
   [data?.before,data?.after,data?.v04?.spring_scene,data?.interpretation?.followup].filter(Boolean);
 if(!dates?.length){body.append(create("p","Historical source scene metadata unavailable.","muted"));return;}
 for(const [index,scene] of dates.entries()){
  const row=create("div",undefined,"scene-row");
  row.append(create("strong",toDay(scene?.date)));
  const id=create("span",typeof scene?.id==="string"?scene.id:"Scene ID not available","mono");
  row.append(id);body.append(row);
 }
}
function personalList(){
 let values=[];
 try{
  const parsed=JSON.parse(localStorage.getItem("infratrack:watchlist:v1")||"[]");
  if(Array.isArray(parsed))values=parsed.filter(x=>safeId(x.id)&&x.id.startsWith("custom-")&&
         typeof x.name==="string"&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)).slice(0,50);
 }catch{}
 const box=$("personalAreas");
 box.replaceChildren();
 if(!values.length){
  box.append(create("p","No browser-saved custom areas yet. Add one from Monitor.","muted"));return;
 }
 for(const area of values){
  const node=create("div",undefined,"personal-line");
  node.append(create("strong",area.name));
  node.append(create("span",
   " · "+area.lat.toFixed(4)+", "+area.lon.toFixed(4)+" · acquisition metadata only"));
  box.append(node);
 }
}
async function choose(site){
 if(!safeId(site.id))return;
 chosen=site;
 const token=++selectionToken;
 const folder=siteFolder(site.id);
 const selection=$("techSite");
 selection.value=site.id;
 set("techSiteTitle",site.name);
 set("techSiteRegion",site.region||"Registered research area");
 set("techSiteStatus","Loading published dataset…");
 set("candidateCount","—");
 set("validOverlap","—");
 set("pixelFraction","—");
 set("modelStatus","—");
 set("groundTruth","—");
 set("interval","—");
 $("imagePair").hidden=true;
 $("candidateList").replaceChildren();
 $("sceneList").replaceChildren();
 $("datasetLinks").replaceChildren();
 for(const id of ["sceneBeforeId","sceneAfterId","sceneSignature","geometryStatus",
                   "screeningDetail","modelDetail","technicalError"]){set(id,"—");}
 const [recentRes,queueRes,dataRes,validationRes]=await Promise.allSettled([
   readJSON(folder+"recent.json"),
   readJSON(folder+"recent_queue.json"),
   readJSON(folder+"data.json"),
   readJSON(folder+"validation_v05.json")
 ]);
 if(token!==selectionToken)return;
 const value=r=>r.status==="fulfilled"?r.value:null;
 const recent=value(recentRes),queue=value(queueRes),
       historical=value(dataRes),validation=value(validationRes);
 set("techSiteStatus",recent?.status||"No recent processed observations");
 set("interval",recent?.status==="ready"?
   toDay(recent.before_date)+" → "+toDay(recent.after_date):
   "No recent clear pair");
 set("candidateCount",metric(recent?.significant_candidate_count));
 set("validOverlap",metric(recent?.joint_clear_percent,"%"));
 set("pixelFraction",metric(recent?.significant_pixel_percent,"%"));
 set("modelStatus",validation?.status||"Validation unavailable");
 set("groundTruth",metric(validation?.ground_truth_label_count));
 set("sceneBeforeId",recent?.before_scene_id||"—");
 set("sceneAfterId",recent?.after_scene_id||"—");
 set("sceneSignature",recent?.observation_signature||"—");
 set("geometryStatus",historical?.road?.geometry_status ||
     (site.road_geometry_status||"—"));
 set("screeningDetail",queue?.selection||"No recent detection queue available");
 set("modelDetail",validation?.message||validation?.warning||
     "Unverified rapid review does not qualify as training ground truth.");
 set("technicalError",recent?.error||recent?.read_errors?.join(" | ")||
      (recent?.status==="ready"?"No pipeline error reported":"No recent clear source pair was produced."));
 const pair=asPair(site,recent,historical);
 if(pair){
  $("imagePair").hidden=false;
  $("beforeImg").src=pair.images[0];
  $("afterImg").src=pair.images[1];
  set("beforeCaption",pair.dates[0]);
  set("afterCaption",pair.dates[1]);
  set("pairMode",pair.source);
 }else set("pairMode","No images processed");
 renderCandidates(queue,site.id);
 renderTimes(historical);
 setSources(site,recent,queue,historical,validation);
 const count=recent?.candidate_scene_count;
 set("sceneInventory",Number.isInteger(count)?
      count+" catalog scenes passed global cloud selection (not all used)": "—");
 const percent=recent?.significant_pixel_percent;
 set("changeInterpretation",typeof percent==="number"?
      "This percentage counts clear pixels above a spectral threshold — NOT "+
      "the percentage of land under construction or changed since a verified baseline.":
      "No valid area change percentage for this site.");
 $("openTraining").href="training.html?site="+encodeURIComponent(site.id);
}
async function init(){
 personalList();
 try{
  const [a,b]=await Promise.all([readJSON("projects.json"),readJSON("recent_manifest.json")]);
  projects=a;manifest=b;
  const stats=portfolioStats(a,b);
  set("statProcessed",stats.processed+" / "+stats.total);
  set("statRecent",stats.recent_ready+" / "+stats.total);
  set("statCandidates",stats.significant_candidates);
  const check=b.checked_at_utc;
  if(typeof check==="string"&&!Number.isNaN(Date.parse(check)))
    set("lastChecked",new Date(check).toLocaleString()+" · recorded build time");
  else set("lastChecked","Unknown");
  set("globalStatus","Showing published measurements. "+
      "No construction classification or accuracy can be inferred from change scores.");
  const sites=(a.sites||[]).filter(x=>safeId(x.id));
  const selector=$("techSite");
  selector.replaceChildren();
  for(const site of sites){
   const option=create("option",site.name+" · "+(site.status||"unknown"));
   option.value=site.id;selector.append(option);
  }
  selector.onchange=()=>{const found=sites.find(x=>x.id===selector.value);if(found)choose(found);};
  const requested=new URLSearchParams(location.search).get("site");
  const current=sites.find(x=>x.id===requested)||sites[0];
  if(current)await choose(current);
  else set("techSiteStatus","No registered processed areas");
 }catch(err){showFailed(err)}
}
init();
global.InfraTechnicalCore=core;
})(typeof window!=="undefined"?window:globalThis);
