/* Registration 2.0: conservative stable-edge fallback; never force alignment. */
(function(root){
"use strict";
const base=(typeof module==="object"&&module.exports)?require("./image_registration.js"):root.InfraImageRegistration;
if(!base)throw Error("Original registration engine missing");
function edgeMap(rgba,w,h){
 const gray=base.createGray(rgba,w,h),out=new Float32Array(w*h);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const p=y*w+x;
  out[p]=Math.min(1,Math.hypot((gray[p+1]-gray[p-1])*.5,(gray[p+w]-gray[p-w])*.5)*2.5);
 }
 return out;
}
function rigidConsensus(matches,w,h){
 if(matches.length<8)return {ok:false,reason:"Too few independent stable edges"};
 let best=[];
 for(const m of matches){
  const near=matches.filter(p=>Math.hypot(p.dx-m.dx,p.dy-m.dy)<=1.3);
  if(near.length>best.length)best=near;
 }
 if(best.length<8||best.length/matches.length<.6)
  return {ok:false,reason:"Stable edges do not agree on translation"};
 const spanX=Math.max(...best.map(p=>p.x))-Math.min(...best.map(p=>p.x));
 const spanY=Math.max(...best.map(p=>p.y))-Math.min(...best.map(p=>p.y));
 const quadrants=new Set(best.map(p=>(p.x<w/2?0:1)+2*(p.y<h/2?0:1)));
 if(spanX<w*.35||spanY<h*.35||quadrants.size<3)
  return {ok:false,reason:"Stable edges lack independent geographic coverage"};
 const dx=base.median(best.map(p=>p.dx)),dy=base.median(best.map(p=>p.dy));
 const rmse=Math.sqrt(best.reduce((s,p)=>s+(p.dx-dx)**2+(p.dy-dy)**2,0)/best.length);
 const similarity=best.reduce((s,p)=>s+p.similarity,0)/best.length,maxShift=Math.hypot(dx,dy);
 if(rmse>.9||similarity<.79||maxShift>5)
  return {ok:false,reason:"Residual or shift exceeds conservative limits"};
 return {ok:true,cx:[dx,0,0],cy:[dy,0,0],rmse,maxShift,
  featureCount:best.length,totalMatches:matches.length,determinant:1,
  method:"Bidirectional stable-edge translation",fallback:true};
}
function estimateRegistration(before,after,w,h,maskA,maskB,options={}){
 const initial=base.estimateRegistration(before,after,w,h,maskA,maskB,options);
 if(initial.ok)return {...initial,fallback:false};
 if(!maskA||!maskB||maskA.length!==w*h||maskB.length!==w*h||w<64||h<64)return initial;
 const a=edgeMap(before,w,h),b=edgeMap(after,w,h);
 const opts={radius:5,search:6,cells:6},points=base.features(a,w,h,maskA,opts),matches=[];
 for(const p of points){
  const forward=base.matchOne(a,b,w,h,p,maskA,maskB,opts);
  if(!forward)continue;
  const q={x:p.x+forward.dx,y:p.y+forward.dy};
  const reverse=base.matchOne(b,a,w,h,q,maskB,maskA,opts);
  if(!reverse||Math.hypot(forward.dx+reverse.dx,forward.dy+reverse.dy)>1.1)continue;
  matches.push(forward);
 }
 const fit=rigidConsensus(matches,w,h);
 return fit.ok?{...fit,baseRejection:initial.reason}:
  {...initial,edgeMatches:matches.length,fallbackReason:fit.reason};
}
const api={edgeMap,rigidConsensus,estimateRegistration};
if(typeof module==="object"&&module.exports)module.exports=api;
root.InfraRegistrationV2=api;
})(typeof window!=="undefined"?window:globalThis);
