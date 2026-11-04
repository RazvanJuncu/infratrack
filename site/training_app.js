/* InfraTrack Training: one region, one simple review flow, optional evidence gate. */
"use strict";
const $=id=>document.getElementById(id);
const validId=s=>/^[a-z0-9-]{3,64}$/.test(s);
const requested=new URLSearchParams(location.search).get("site");
let selectedSite=null,packageData=null,quick=null,verifiedTarget=null;
function status(message){$("quickReviewStatus").textContent=message}
function clearIfMissing(message){
 $("quickCandidateName").textContent=message;
 $("quickCandidateDetail").textContent="No fabricated satellite examples.";
 $("quickProgress").textContent="Unavailable";
 status("No real source data for this area. Try another location.");
 for(const id of ["quickConstruction","quickAgriculture","quickUnchanged","quickUnsure",
                  "quickPrev","quickNext","quickUndo","quickExport","quickVerify"])
   $(id).disabled=true;
}
function setLocation(item) {
 const link=document.createElement("a");
 link.href="https://www.openstreetmap.org/?mlat="+encodeURIComponent(item.lat)+
   "&mlon="+encodeURIComponent(item.lon)+"#map=17/"+item.lat+"/"+item.lon;
 link.target="_blank";link.rel="noopener noreferrer";
 link.textContent="View location on OpenStreetMap";
 $("candidateLocation").replaceChildren(link);
}
function showVerify(item,classification){
 verifiedTarget=item;
 $("labelClass").value=classification;
 $("labelSite").value=item.site_group_suggestion||
  ("block_r"+String(Math.floor(item.row/25)).padStart(2,"0")+
  "_c"+String(Math.floor(item.col/25)).padStart(2,"0"));
 $("verifySelected").textContent=
   selectedSite.name+" · "+item.id+" · "+classification.toUpperCase()+
   " (not verified until independent evidence is reviewed)";
 $("evidencePanel").hidden=false;
 $("evidencePanel").scrollIntoView({behavior:"smooth",block:"start"});
}
async function load(){
 try{
  const resp=await fetch("projects.json",{cache:"no-store"});
  if(!resp.ok)throw Error("Project catalog unavailable");
  const manifest=await resp.json();
  const ready=(manifest.sites||[]).filter(x=>x.status==="ready"&&validId(x.id));
  const selector=$("regionSelect");
  selector.replaceChildren();
  for(const site of ready){
    const opt=document.createElement("option");
    opt.value=site.id;
    opt.textContent=site.name+" · "+site.region;
    selector.append(opt);
  }
  if(!ready.length){clearIfMissing("No real training areas available");return}
  selectedSite=ready.find(x=>x.id===requested)||ready[0];
  selector.value=selectedSite.id;
  selector.onchange=()=>{
    const next=ready.find(x=>x.id===selector.value);
    if(next)location.assign("training.html?site="+encodeURIComponent(next.id));
  };
  history.replaceState(null,"",location.pathname+"?site="+encodeURIComponent(selectedSite.id));
  const prefix=selectedSite.path;
  const [inspectionResponse,queueResponse]=await Promise.all([
    fetch(prefix+"inspection_v05.json",{cache:"no-store"}),
    fetch(prefix+"review_queue_v06.json",{cache:"no-store"})
  ]);
  if(!inspectionResponse.ok||!queueResponse.ok)throw Error("Real pixel measurements or review queue unavailable");
  packageData=await inspectionResponse.json();
  const queue=await queueResponse.json();
  if(packageData.status!=="ready"||queue.status!=="review_candidates_not_ground_truth"
      ||packageData.study_id!==queue.study_id||packageData.signature!==queue.signature)
    throw Error("Satellite scenes and suggested pixels have mismatched provenance");
  if(!window.InfraQuickLabel)throw Error("Quick classification engine unavailable");
  quick=window.InfraQuickLabel.createApp({
    queue:queue,pack:packageData,assetPrefix:prefix,
    onSelect(item){setLocation(item);$("evidencePanel").hidden=true;verifiedTarget=null;},
    onVerify(item,label){showVerify(item,label)}
  });
 }catch(err){
   clearIfMissing(err.message);
   console.error("Training init error:",err);
 }
}
$("submitLabel").addEventListener("click",()=>{
 if(!verifiedTarget||!packageData){
   $("labelMessage").textContent="No review example selected";return;
 }
 const label=$("labelClass").value;
 if(!["construction","agriculture","unchanged"].includes(label)){
   $("labelMessage").textContent="Unsupported class";return;
 }
 const site_group=$("labelSite").value.trim(), evidence_url=$("labelUrl").value.trim(),
  evidence_date=$("labelDate").value, note=$("labelNote").value.trim(),
  attestation=$("labelAttestation").checked;
 if(!/^[a-zA-Z0-9_-]{4,64}$/.test(site_group)){
   $("labelMessage").textContent="Site group: 4–64 letters, digits, dash or underscore";return;
 }
 try{
   const parsed=new URL(evidence_url);
   if(!["https:","http:"].includes(parsed.protocol))throw Error("Scheme");
 }catch{
   $("labelMessage").textContent="Provide a full HTTP(S) URL to independent dated evidence";return;
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(evidence_date) ||
     evidence_date>new Date().toISOString().slice(0,10) ||
     note.length<12 || !attestation){
   $("labelMessage").textContent="Evidence URL, valid date, explanation (12+ chars) and confirmation are required";return;
 }
 const payload={
   study_id:packageData.study_id,signature:packageData.signature,
   row:verifiedTarget.row,col:verifiedTarget.col,label,site_group,
   question_version:"change-types-v2",
   evidence_url,evidence_date,note,attestation:true
 };
 const block=String.fromCharCode(96).repeat(3);
 const body="Owner-reviewed, independently dated research evidence. Not automatically audited.\n\n"+
   block+"infratrack-label\n"+JSON.stringify(payload,null,2)+"\n"+block+"\n\n"+
   "Please confirm this annotation is substantiated and then submit the issue.";
 const title="[InfraTrack label] "+label+" "+site_group+
   " pixel "+payload.row+","+payload.col;
 const url=new URL("https://github.com/RazvanJuncu/infratrack/issues/new");
 url.searchParams.set("title",title);url.searchParams.set("body",body);
 const opened=window.open(url.toString(),"_blank","noopener,noreferrer");
 $("labelMessage").textContent="GitHub issue composer opened (or blocked). Submit the issue yourself; this action does not upload a label.";
});
load();
