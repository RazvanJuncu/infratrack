/* Change Intelligence 1.0: coherent, unverified visual candidates.
   Requires aligned images and two valid local cloud masks. Not a trained AI. */
(function(root){
"use strict";
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function median(a){
 if(!a.length)return 0;
 const s=a.slice().sort((x,y)=>x-y),n=s.length;
 return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;
}
function segment(before,after,w,h,maskA,maskB,options={}){
 const n=w*h;
 if(!Number.isInteger(w)||!Number.isInteger(h)||n<1||n>2048*2048||
  !(before instanceof Uint8ClampedArray)||!(after instanceof Uint8ClampedArray)||
  before.length!==n*4||after.length!==n*4)
  throw Error("Matching aligned RGBA images required");
 if(!maskA||!maskB||maskA.length!==n||maskB.length!==n)
  throw Error("Both local cloud masks required");
 const eligible=new Uint8Array(n);let valid=0;
 for(let p=0;p<n;p++){
  const i=p*4;
  if(maskA[p]!==1||maskB[p]!==1||!before[i+3]||!after[i+3])continue;
  if((before[i]===0&&before[i+1]===0&&before[i+2]===0)||
     (after[i]===0&&after[i+1]===0&&after[i+2]===0))continue;
  eligible[p]=1;valid++;
 }
 const rgba=new Uint8ClampedArray(n*4);
 if(!valid)return {rgba,regions:[],totalRegions:0,validPixels:0,
  candidatePixels:0,status:"insufficient_clear_pixels"};
 const step=Math.max(1,Math.floor(n/12000)),samples=[[],[],[]];
 for(let p=0;p<n;p+=step)if(eligible[p]){
  for(let c=0;c<3;c++)samples[c].push(after[p*4+c]-before[p*4+c]);
 }
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
 const candidate=new Uint8Array(n);
 for(let p=0;p<n;p++)if(eligible[p]&&difference[p]>=threshold)candidate[p]=1;
 const filtered=new Uint8Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x;if(!candidate[p])continue;
  let neighbors=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;
   const xx=x+dx,yy=y+dy;
   if(xx>=0&&xx<w&&yy>=0&&yy<h&&candidate[yy*w+xx])neighbors++;
  }
  if(neighbors>=2)filtered[p]=1;
 }
 const seen=new Uint8Array(n),regions=[],minPixels=clamp(Math.floor(Number(options.minRegionPixels??9)),3,500);
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
    const j=yy*w+xx;
    if(filtered[j]&&!seen[j]){seen[j]=1;queue.push(j)}
   }
  }
  if(queue.length<minPixels)continue;
  for(const p of queue){
   const i=p*4;rgba[i]=215;rgba[i+1]=92;rgba[i+2]=86;
   rgba[i+3]=clamp(Math.round(96+difference[p]*.8),110,194);
  }
  regions.push({pixels:queue.length,
   bbox:{x:left,y:top,width:right-left+1,height:bottom-top+1},
   meanDelta:Math.round(sumDelta/queue.length*10)/10});
 }
 regions.sort((a,b)=>b.pixels-a.pixels||b.meanDelta-a.meanDelta);
 const candidatePixels=regions.reduce((sum,r)=>sum+r.pixels,0);
 return {rgba,regions:regions.slice(0,12),totalRegions:regions.length,
  candidatePixels,validPixels:valid,threshold:Math.round(threshold*10)/10,
  status:"unverified_rgb_regions",model:"Deterministic RGB grouping, not trained AI"};
}
const api={segment};
if(typeof module==="object"&&module.exports)module.exports=api;
root.InfraChangeIntelligence=api;
})(typeof window!=="undefined"?window:globalThis);
