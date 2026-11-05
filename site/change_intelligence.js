/* InfraTrack Change Intelligence 1.1
   Deterministic, unverified RGB signals + opt-in NDVI/persistence evidence.
   Never label a region as confirmed construction or assign AI confidence. */
(function(root){
"use strict";
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
function median(a){
 if(!a.length)return 0;
 const s=a.slice().sort((x,y)=>x-y),n=s.length;
 return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;
}
function shadowLike(a,b,i){
 const old=(a[i]+a[i+1]+a[i+2])/3;
 const newer=(b[i]+b[i+1]+b[i+2])/3;
 const light=Math.max(old,newer),dark=Math.min(old,newer);
 if(light<30||light>175||dark<10||dark/light>.66)return false;
 const sumA=a[i]+a[i+1]+a[i+2],sumB=b[i]+b[i+1]+b[i+2];
 if(sumA<1||sumB<1)return false;
 // Multiplicative illumination change without strong chromaticity change.
 let chroma=0;
 for(let c=0;c<3;c++)chroma+=Math.abs(a[i+c]/sumA-b[i+c]/sumB);
 return chroma<.075;
}
function outline(labels,w,h,id){
 if(!labels||labels.length!==w*h||!Number.isInteger(id)||id<=0)
  throw Error("Valid region labels and id required");
 const overlay=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x;
  if(labels[p]!==id)continue;
  if(x&&labels[p-1]===id&&x<w-1&&labels[p+1]===id&&
     y&&labels[p-w]===id&&y<h-1&&labels[p+w]===id)continue;
  const q=p*4;overlay[q]=212;overlay[q+1]=154;overlay[q+2]=88;overlay[q+3]=255;
 }
 return overlay;
}
function segment(before,after,w,h,maskA,maskB,options={}){
 const n=w*h;
 if(!Number.isInteger(w)||!Number.isInteger(h)||n<1||n>2048*2048||
  !(before instanceof Uint8ClampedArray)||!(after instanceof Uint8ClampedArray)||
  before.length!==n*4||after.length!==n*4)
  throw Error("Matching aligned RGBA images required");
 if(!maskA||!maskB||maskA.length!==n||maskB.length!==n)
  throw Error("Both local cloud masks required");
 const eligible=new Uint8Array(n),rgba=new Uint8ClampedArray(n*4),labels=new Uint16Array(n);
 let valid=0;
 for(let p=0;p<n;p++){
  const i=p*4;
  if(maskA[p]!==1||maskB[p]!==1||!before[i+3]||!after[i+3])continue;
  if((before[i]===0&&before[i+1]===0&&before[i+2]===0)||
     (after[i]===0&&after[i+1]===0&&after[i+2]===0))continue;
  eligible[p]=1;valid++;
 }
 if(!valid)return {rgba,labels,regions:[],totalRegions:0,validPixels:0,
  candidatePixels:0,shadowLikePixels:0,status:"insufficient_clear_pixels"};
 const step=Math.max(1,Math.floor(n/12000)),samples=[[],[],[]];
 for(let p=0;p<n;p+=step)if(eligible[p])
  for(let c=0;c<3;c++)samples[c].push(after[p*4+c]-before[p*4+c]);
 const offsets=samples.map(a=>clamp(median(a),-22,22));
 const difference=new Float32Array(n),noise=[];
 for(let p=0;p<n;p++)if(eligible[p]){
  let delta=0;
  for(let c=0;c<3;c++)delta+=Math.abs(after[p*4+c]-before[p*4+c]-offsets[c]);
  difference[p]=delta/3;
  if(p%step===0)noise.push(difference[p]);
 }
 const baseline=median(noise),mad=median(noise.map(v=>Math.abs(v-baseline)));
 const threshold=Math.max(clamp(Number(options.minDelta??42),15,120),
  Math.min(105,baseline+2.8*mad));
 const candidates=new Uint8Array(n);
 let shadowLikePixels=0;
 for(let p=0;p<n;p++)if(eligible[p]&&difference[p]>=threshold){
  if(options.includeShadowLike!==true&&shadowLike(before,after,p*4)){
   shadowLikePixels++;continue;
  }
  candidates[p]=1;
 }
 const filtered=new Uint8Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x;if(!candidates[p])continue;
  let neighbors=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dy&&!dx)continue;
   const xx=x+dx,yy=y+dy;
   if(xx>=0&&xx<w&&yy>=0&&yy<h&&candidates[yy*w+xx])neighbors++;
  }
  if(neighbors>=2)filtered[p]=1;
 }
 const seen=new Uint8Array(n),regions=[],minPixels=clamp(
  Math.floor(Number(options.minRegionPixels??9)),3,500);
 for(let start=0;start<n;start++){
  if(!filtered[start]||seen[start])continue;
  const queue=[start];seen[start]=1;
  let left=w,top=h,right=0,bottom=0,sumDelta=0;
  for(let qi=0;qi<queue.length;qi++){
   const p=queue[qi],x=p%w,y=(p/w)|0;
   left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
   sumDelta+=difference[p];
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy)continue;
    const xx=x+dx,yy=y+dy;
    if(xx<0||xx>=w||yy<0||yy>=h)continue;
    const next=yy*w+xx;
    if(filtered[next]&&!seen[next]){seen[next]=1;queue.push(next)}
   }
  }
  if(queue.length<minPixels)continue;
  const id=regions.length+1;
  if(id>65535)break;
  for(const p of queue){
   labels[p]=id;
   const i=p*4;rgba[i]=215;rgba[i+1]=92;rgba[i+2]=86;
   rgba[i+3]=clamp(Math.round(96+difference[p]*.8),110,194);
  }
  regions.push({id,pixels:queue.length,
   bbox:{x:left,y:top,width:right-left+1,height:bottom-top+1},
   meanDelta:Math.round(sumDelta/queue.length*10)/10});
 }
 regions.sort((a,b)=>b.pixels-a.pixels||b.meanDelta-a.meanDelta);
 const candidatePixels=regions.reduce((sum,r)=>sum+r.pixels,0);
 return {rgba,labels,regions:regions.slice(0,12),totalRegions:regions.length,
  candidatePixels,validPixels:valid,shadowLikePixels,
  threshold:Math.round(threshold*10)/10,
  status:"unverified_rgb_regions",model:"Deterministic RGB grouping; shadow-like filter is heuristic"};
}
function warpScalar(values,w,h,registration){
 if(!values||values.length!==w*h||!registration?.ok)
  throw Error("Valid spectral band and verified registration required");
 const aligned=new Float32Array(w*h).fill(NaN);
 const a=registration.cx,b=registration.cy;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=(x-w/2)/(w/2),v=(y-h/2)/(h/2);
  const sx=Math.round(x+a[0]+a[1]*u+a[2]*v);
  const sy=Math.round(y+b[0]+b[1]*u+b[2]*v);
  if(sx>=0&&sx<w&&sy>=0&&sy<h)aligned[y*w+x]=values[sy*w+sx];
 }
 return aligned;
}
function summarizeNDVI(regions,labels,beforeNDVI,afterNDVI){
 if(!labels||beforeNDVI.length!==labels.length||afterNDVI.length!==labels.length)
  throw Error("NDVI must use the same verified pixel grid as regions");
 return regions.map(r=>{
  let valid=0,sum=0,previous=0;
  for(let p=0;p<labels.length;p++)if(labels[p]===r.id&&
    Number.isFinite(beforeNDVI[p])&&Number.isFinite(afterNDVI[p])){
   valid++;sum+=afterNDVI[p]-beforeNDVI[p];previous+=beforeNDVI[p];
  }
  if(valid<Math.max(6,r.pixels*.5))return {id:r.id,status:"insufficient_spectral_coverage",valid};
  const delta=sum/valid;
  return {id:r.id,status:"measured",valid,
   delta:Math.round(delta*1000)/1000,
   beforeMean:Math.round(previous/valid*1000)/1000,
   signal:delta<-.15?"vegetation-index decrease":
    delta>.15?"vegetation-index increase":"limited NDVI difference"};
 });
}
function persistence(regions,labels,later,clearMask){
 if(!later?.labels||later.labels.length!==labels.length||
    !clearMask||clearMask.length!==labels.length)
  throw Error("Later scene must be registered and locally screened");
 return regions.map(r=>{
  let clear=0,overlap=0;
  for(let p=0;p<labels.length;p++)if(labels[p]===r.id&&clearMask[p]===1){
   clear++;if(later.labels[p]>0)overlap++;
  }
  if(clear<Math.max(6,r.pixels*.5))
   return {id:r.id,status:"insufficient_later_coverage",clear};
  const rate=overlap/clear;
  return {id:r.id,status:rate>=.35?"signal_still_visible":"not_correlated",
   clear,overlap,fraction:Math.round(rate*1000)/1000};
 });
}
const api={segment,outline,shadowLike,warpScalar,summarizeNDVI,persistence};
if(typeof module==="object"&&module.exports)module.exports=api;
root.InfraChangeIntelligence=api;
})(typeof window!=="undefined"?window:globalThis);
