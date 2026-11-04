/* InfraTrack residual image co-registration.
   Original Sentinel-2 L2A is orthorectified; this only estimates a SMALL
   residual affine correction from stable textured features. No free-form warp.
   Reject ambiguous fits rather than inventing new/vanishing construction.
*/
(function(root){
"use strict";
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function median(a){if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y);return (b[(b.length-1)>>1]+b[b.length>>1])/2}
function validPixels(data,w,h){
 return !!data&&data.length===w*h*4&&ArrayBuffer.isView(data);
}
function createGray(data,w,h){
 if(!validPixels(data,w,h))throw Error("Invalid original satellite RGB pixel buffer");
 const out=new Float32Array(w*h);
 for(let i=0;i<w*h;i++){
   const j=i*4;
   out[i]=(data[j]*.299+data[j+1]*.587+data[j+2]*.114)/255;
 }
 return out;
}
function clearMaskValid(mask,w,h){return !!mask&&mask.length===w*h}
function clearAt(mask,pos){return !mask||mask[pos]===1}
function corner(gray,w,x,y){
 let xx=0,yy=0,xy=0;
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   const i=(y+dy)*w+x+dx;
   const gx=gray[i+1]-gray[i-1];
   const gy=gray[i+w]-gray[i-w];
   xx+=gx*gx;yy+=gy*gy;xy+=gx*gy;
 }
 return Math.max(0,(xx*yy-xy*xy)/(xx+yy+1e-10));
}
function patchInfo(gray,w,h,cx,cy,r,mask){
 if(cx-r<0||cy-r<0||cx+r>=w||cy+r>=h)return null;
 let sum=0,sumSq=0,n=0;
 for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++){
   const i=y*w+x;
   if(!clearAt(mask,i))return null;
   const v=gray[i];sum+=v;sumSq+=v*v;n++;
 }
 const mean=sum/n,variance=sumSq/n-mean*mean;
 if(variance<.00045)return null; // reject uniform crop/sky/cloud
 return {mean,variance,n};
}
function correlation(a,b,w,h,ax,ay,bx,by,r,am,bm,pa){
 const pb=patchInfo(b,w,h,bx,by,r,bm);
 if(!pb)return -1;
 let dot=0;
 for(let j=-r;j<=r;j++)for(let i=-r;i<=r;i++){
   dot+=(a[(ay+j)*w+ax+i]-pa.mean)*
       (b[(by+j)*w+bx+i]-pb.mean);
 }
 return dot/(pa.n*Math.sqrt(pa.variance*pb.variance)+1e-12);
}
// Texture corners from spatially distributed regions (prevents one active
// construction patch from deciding the warp for an entire 2km window).
function features(gray,w,h,mask,options={}){
 const r=options.radius||5,cells=options.cells||6;
 const points=[],margin=r+(options.search||9)+4;
 if(w<64||h<64)return points;
 for(let gy=0;gy<cells;gy++)for(let gx=0;gx<cells;gx++){
   const left=Math.max(margin,Math.floor(gx*w/cells));
   const top=Math.max(margin,Math.floor(gy*h/cells));
   const right=Math.min(w-margin,Math.floor((gx+1)*w/cells));
   const bottom=Math.min(h-margin,Math.floor((gy+1)*h/cells));
   const scores=[];
   for(let y=top;y<bottom;y+=3)for(let x=left;x<right;x+=3){
     if(!clearAt(mask,y*w+x))continue;
     const energy=corner(gray,w,x,y);
     if(energy<.001)continue;
     scores.push({x,y,energy});
   }
   scores.sort((a,b)=>b.energy-a.energy);
   let picked=0;
   for(const p of scores){
     if(points.some(q=>q.cell===gy*cells+gx&&
        Math.hypot(q.x-p.x,q.y-p.y)<13))continue;
     if(!patchInfo(gray,w,h,p.x,p.y,r,mask))continue;
     points.push({...p,cell:gy*cells+gx});
     if(++picked===2)break;
   }
 }
 return points;
}
function matchOne(a,b,w,h,p,am,bm,options={}){
 const r=options.radius||5,s=options.search||9;
 const pa=patchInfo(a,w,h,p.x,p.y,r,am);
 if(!pa)return null;
 let best=-1,second=-1,bx=0,by=0;
 const scores=[];
 for(let dy=-s;dy<=s;dy++)for(let dx=-s;dx<=s;dx++){
   const x=p.x+dx,y=p.y+dy;
   const value=correlation(a,b,w,h,p.x,p.y,x,y,r,am,bm,pa);
   if(value>-1) scores.push({x,y,value});
   if(value>best){best=value;bx=x;by=y}
 }
 if(best<.76)return null;
 // Reject repeated structures where a different displacement matches just as well.
 for(const s0 of scores){
   if(Math.hypot(s0.x-bx,s0.y-by)>=3&&s0.value>second)second=s0.value;
 }
 if(second>best-.045)return null;
 return {...p,dx:bx-p.x,dy:by-p.y,similarity:best};
}
function solve3(M,v){
 const a=[
  [M[0][0],M[0][1],M[0][2],v[0]],
  [M[1][0],M[1][1],M[1][2],v[1]],
  [M[2][0],M[2][1],M[2][2],v[2]]
 ];
 for(let col=0;col<3;col++){
   let pivot=col;
   for(let row=col+1;row<3;row++)if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;
   if(Math.abs(a[pivot][col])<1e-8)return null;
   [a[col],a[pivot]]=[a[pivot],a[col]];
   const fac=a[col][col];
   for(let j=col;j<4;j++)a[col][j]/=fac;
   for(let row=0;row<3;row++)if(row!==col){
     const f=a[row][col];
     for(let j=col;j<4;j++)a[row][j]-=f*a[col][j];
   }
 }
 return [a[0][3],a[1][3],a[2][3]];
}
function fitAffine(matches,w,h,options={}){
 if(matches.length<8)return {ok:false,reason:"Too few reliable stable features"};
 const midx=w/2,midy=h/2;
 const inputs=matches.map(p=>({
   x:p.x,y:p.y,u:(p.x-midx)/midx,v:(p.y-midy)/midy,
   dx:p.dx,dy:p.dy,similarity:p.similarity
 }));
 let cx=[median(inputs.map(x=>x.dx)),0,0];
 let cy=[median(inputs.map(x=>x.dy)),0,0];
 let inliers=inputs;
 for(let iter=0;iter<5;iter++){
   const residuals=inputs.map(p=>
     Math.hypot(p.dx-(cx[0]+cx[1]*p.u+cx[2]*p.v),
                p.dy-(cy[0]+cy[1]*p.u+cy[2]*p.v)));
   const limit=iter===0?3.5:Math.max(1.45,Math.min(2.4,median(residuals)*2.5));
   inliers=inputs.filter((p,i)=>residuals[i]<=limit);
   if(inliers.length<8)break;
   const A=Array.from({length:3},()=>[0,0,0]);
   const vx=[0,0,0],vy=[0,0,0];
   for(const p of inliers){
     const z=[1,p.u,p.v],q=Math.max(.2,p.similarity);
     for(let i=0;i<3;i++){
       vx[i]+=q*z[i]*p.dx;vy[i]+=q*z[i]*p.dy;
       for(let j=0;j<3;j++)A[i][j]+=q*z[i]*z[j];
     }
   }
   const sx=solve3(A,vx),sy=solve3(A,vy);
   if(!sx||!sy)return {ok:false,reason:"Stable features are not spatially distributed"};
   cx=sx;cy=sy;
 }
 if(inliers.length<8||inliers.length/matches.length<.55)
   return {ok:false,reason:"Too few consistent image features"};
 const spanX=Math.max(...inliers.map(p=>p.x))-Math.min(...inliers.map(p=>p.x));
 const spanY=Math.max(...inliers.map(p=>p.y))-Math.min(...inliers.map(p=>p.y));
 if(spanX<w*.35||spanY<h*.35)
   return {ok:false,reason:"Stable features do not cover enough of the area"};
 const residuals=inliers.map(p=>Math.hypot(
   p.dx-(cx[0]+cx[1]*p.u+cx[2]*p.v),
   p.dy-(cy[0]+cy[1]*p.u+cy[2]*p.v)));
 const rmse=Math.sqrt(residuals.reduce((s,x)=>s+x*x,0)/residuals.length);
 // Conservative corrections: avoid severe stretch, shear, or forced alignment
 // of genuinely changed terrain. These limits are in display pixels.
 const limit=Math.max(...[
   [-1,-1],[-1,1],[1,-1],[1,1],[0,0]
 ].map(([u,v])=>Math.hypot(cx[0]+cx[1]*u+cx[2]*v,cy[0]+cy[1]*u+cy[2]*v)));
 const determinant=(1+cx[1]/(w/2))*(1+cy[2]/(h/2))-
                       cx[2]*cy[1]/((w/2)*(h/2));
 if(rmse>1.25||limit>6||Math.abs(determinant-1)>.025||
    Math.abs(cx[1])+Math.abs(cx[2])>3||
    Math.abs(cy[1])+Math.abs(cy[2])>3)
   return {ok:false,reason:"Geometric correction exceeds conservative safety limits",
        rmse,shift:limit,featureCount:inliers.length};
 return {ok:true,cx,cy,rmse,featureCount:inliers.length,
   totalMatches:matches.length,maxShift:limit,determinant,
   method:"Stable-feature constrained affine registration"};
}
function estimateRegistration(before,after,w,h,beforeMask,afterMask,options={}){
 if(!validPixels(before,w,h)||!validPixels(after,w,h))
   return {ok:false,reason:"Original RGBA buffers missing or dimensions differ"};
 if(beforeMask&&!clearMaskValid(beforeMask,w,h)||
    afterMask&&!clearMaskValid(afterMask,w,h))
   return {ok:false,reason:"Invalid scene cloud mask dimensions"};
 if(w<64||h<64)return {ok:false,reason:"Images too small for reliable alignment"};
 const a=createGray(before,w,h),b=createGray(after,w,h);
 const pts=features(a,w,h,beforeMask,options);
 const matches=[];
 for(const p of pts){
   const match=matchOne(a,b,w,h,p,beforeMask,afterMask,options);
   if(match)matches.push(match);
 }
 const result=fitAffine(matches,w,h,options);
 return {...result,detectedPoints:pts.length,acceptedMatches:matches.length,
   screenedClouds:Boolean(beforeMask&&afterMask)};
}
function warpRGBA(source,w,h,affine,mask){
 if(!validPixels(source,w,h)||!affine?.ok)
   throw Error("A verified geometric transform and source pixels are required");
 const out=new Uint8ClampedArray(w*h*4);
 const alignedMask=mask?new Uint8Array(w*h):null;
 const cx=affine.cx,cy=affine.cy;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const u=(x-w/2)/(w/2),v=(y-h/2)/(h/2);
   const sx=x+cx[0]+cx[1]*u+cx[2]*v;
   const sy=y+cy[0]+cy[1]*u+cy[2]*v;
   if(sx<0||sy<0||sx>=w-1||sy>=h-1)continue;
   const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
   const i=y*w+x;
   for(let c=0;c<3;c++){
     const a=source[(y0*w+x0)*4+c],b=source[(y0*w+x0+1)*4+c];
     const cc=source[((y0+1)*w+x0)*4+c],d=source[((y0+1)*w+x0+1)*4+c];
     out[i*4+c]=(a*(1-fx)+b*fx)*(1-fy)+(cc*(1-fx)+d*fx)*fy;
   }
   out[i*4+3]=255;
   if(alignedMask)alignedMask[i]=mask[Math.round(sy)*w+Math.round(sx)]||0;
 }
 return {rgba:out,mask:alignedMask,width:w,height:h};
}
const exports={median,createGray,features,matchOne,solve3,fitAffine,
 estimateRegistration,warpRGBA};
if(typeof module==="object"&&module.exports)module.exports=exports;
root.InfraImageRegistration=exports;
})(typeof window!=="undefined"?window:globalThis);
