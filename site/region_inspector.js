/* InfraTrack Region Inspector 1.2 — explain evidence, never fabricate land-use labels.
   SCL refers to Copernicus Sentinel-2 L2A scene classes, not ML confidence.
   RGB regions themselves are cloud-screened; cloud-related signals are
   adjacency risks only. An industrial site cannot be confirmed from this data. */
(function(root){
"use strict";
const CLOUD=new Set([8,9,10]);
const CLOUD_SHADOW=new Set([3]);
function clamp(n,a,b){return Math.min(b,Math.max(a,n))}
function rgbShadow(before,after,i){
 const a=(before[i]+before[i+1]+before[i+2])/3;
 const b=(after[i]+after[i+1]+after[i+2])/3;
 const dark=Math.min(a,b),light=Math.max(a,b);
 if(light<30||light>175||dark<10||dark/light>.66)return false;
 const totalA=before[i]+before[i+1]+before[i+2];
 const totalB=after[i]+after[i+1]+after[i+2];
 if(!totalA||!totalB)return false;
 let chroma=0;
 for(let c=0;c<3;c++)chroma+=Math.abs(before[i+c]/totalA-after[i+c]/totalB);
 return chroma<.075;
}
function regionQuality(result,region,w,h,beforeRGB,afterRGB,beforeSCL,afterSCL){
 if(!result?.labels||result.labels.length!==w*h||!region?.id)
  throw Error("A verified coherent change region is required");
 const n=w*h;
 const haveRGB=beforeRGB?.length===n*4&&afterRGB?.length===n*4;
 const haveSCL=beforeSCL?.length===n&&afterSCL?.length===n;
 let count=0,shadow=0,nearCloud=0,nearCloudShadow=0;
 for(let p=0;p<n;p++)if(result.labels[p]===region.id){
  count++;if(haveRGB&&rgbShadow(beforeRGB,afterRGB,p*4))shadow++;
  if(!haveSCL)continue;
  const x=p%w,y=Math.floor(p/w);
  let cloud=false,cloudShadow=false;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dy&&!dx)continue;
   const xx=x+dx,yy=y+dy;
   if(xx<0||xx>=w||yy<0||yy>=h)continue;
   const q=yy*w+xx;
   if(CLOUD.has(beforeSCL[q])||CLOUD.has(afterSCL[q]))cloud=true;
   if(CLOUD_SHADOW.has(beforeSCL[q])||CLOUD_SHADOW.has(afterSCL[q]))
    cloudShadow=true;
  }
  if(cloud)nearCloud++;
  if(cloudShadow)nearCloudShadow++;
 }
 return {pixels:count,haveSCL,haveRGB,
  shadowFraction:haveRGB&&count?shadow/count:null,
  cloudAdjacentFraction:haveSCL&&count?nearCloud/count:null,
  cloudShadowAdjacentFraction:haveSCL&&count?nearCloudShadow/count:null};
}
function interpretRegion(region,qa={},ndvi=null,later=null){
 if(!region||!Number.isFinite(region.meanDelta))
  throw Error("Region RGB evidence is missing");
 let hypothesis="Unclassified visual change",
     rationale="RGB values differ coherently, but this alone does not identify the cause.",
     alternative="Possible causes include land management, changes in surface material, lighting or atmospheric effects.",
     evidenceLevel="RGB only";
 const cloud=Number.isFinite(qa.cloudAdjacentFraction)?qa.cloudAdjacentFraction:0;
 const nearShadow=Number.isFinite(qa.cloudShadowAdjacentFraction)?qa.cloudShadowAdjacentFraction:0;
 const lighting=Number.isFinite(qa.shadowFraction)?qa.shadowFraction:0;
 const vegetation=ndvi?.status==="measured"&&Number.isFinite(ndvi.delta);
 const persists=later?.status==="signal_still_visible";
 const fleeting=later?.status==="not_correlated";
 if(vegetation)evidenceLevel="RGB + B04/B08 reflectance";
 if(later)evidenceLevel+=(vegetation?" + later observation":" + later observation");
 if(cloud>=.12||nearShadow>=.18){
  hypothesis=cloud>=.12?"Possible cloud-edge artefact":"Possible cloud-shadow influence";
  rationale="Cloud or cloud-shadow SCL classes occur immediately beside this clear-classified region.";
  alternative="The changed pixels are not classified as clouds. A genuine nearby ground change is still possible.";
 }else if(lighting>=.55){
  hypothesis="Possible shadow / illumination change";
  rationale="Most changed pixels brighten or darken while keeping similar RGB color proportions.";
  alternative="A real change of dark surface material could produce a similar signal.";
 }else if(vegetation&&ndvi.delta>=.15){
  hypothesis="Possible vegetation growth";
  rationale="NDVI increased across the region between the selected acquisitions.";
  alternative="Crop growth is one explanation; natural vegetation or seasonal effects are also possible.";
 }else if(vegetation&&ndvi.delta<=-.15){
  hypothesis="Possible harvest or vegetation loss";
  rationale="NDVI decreased across the region, consistent with reduced live vegetation.";
  alternative="Could be harvesting, clearing, seasonal senescence or soil exposure; industrial development is not established.";
 }else if(fleeting){
  hypothesis="Possibly transient visual change";
  rationale="A later clear, aligned RGB comparison did not corroborate this candidate signal.";
  alternative="Later image timing and vegetation cycles can make genuine changes disappear from RGB comparisons.";
 }else if(persists&&vegetation&&Math.abs(ndvi.delta)<.08&&region.meanDelta>=50){
  hypothesis="Possible persistent surface modification";
  rationale="A later RGB observation corroborates the change, with limited NDVI difference.";
  alternative="Groundworks or industrial activity are possible, but so are bare-soil changes, agriculture and other uses.";
 }else if(persists){
  hypothesis="Persistent visual difference";
  rationale="A later clear, aligned RGB observation also shows a candidate difference at this location.";
  alternative="Persistent RGB changes still do not identify whether this is construction, farmland or another surface process.";
 }
 const facts=[
  region.pixels+" display pixels · mean RGB Δ "+region.meanDelta.toFixed(1),
  qa.haveSCL?
   "SCL cloud adjacency: "+Math.round(clamp(cloud,0,1)*100)+"% of region pixels":
   "SCL cloud adjacency: unavailable",
  lighting||lighting===0&&qa.haveRGB?
   "Shadow-like RGB behavior: "+Math.round(clamp(lighting,0,1)*100)+"%":
   "Shadow-like RGB behavior: unavailable",
  vegetation?"NDVI Δ "+(ndvi.delta>=0?"+":"")+ndvi.delta.toFixed(3):
   "NDVI: not measured or insufficient coverage",
  later?.status==="signal_still_visible"?"Later RGB signal: corroborated":
  later?.status==="not_correlated"?"Later RGB signal: not corroborated":
  later?.status==="insufficient_later_coverage"?"Later RGB: insufficient clear coverage":
   "Later RGB: not checked"
 ];
 return {hypothesis,rationale,alternative,evidenceLevel,facts,
  unverified:true,
  limitation:"Research-stage interpretation — not AI confidence or verified land-use classification."};
}
const api={regionQuality,interpretRegion};
if(typeof module==="object"&&module.exports)module.exports=api;
root.InfraRegionInspector=api;
})(typeof window!=="undefined"?window:globalThis);
