const test=require('node:test');
const assert=require('node:assert/strict');
const registration=require('../site/image_registration.js');
const core=require('../site/monitor_workspace_core.js');
const SIZE=256;
function texture(w=SIZE,h=SIZE){
 const out=new Uint8ClampedArray(w*h*4);
 let seed=3267719;
 for(let p=0;p<w*h;p++){
   seed=(Math.imul(1664525,seed)+1013904223)>>>0;
   const v=55+(seed%155);
   out[p*4]=v;out[p*4+1]=Math.min(255,v+7);
   out[p*4+2]=Math.max(0,v-11);out[p*4+3]=255;
 }
 return out;
}
function moved(original,w,h,dx,dy){
 const out=new Uint8ClampedArray(original.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const fromX=x-dx,fromY=y-dy;
   if(fromX<0||fromY<0||fromX>=w||fromY>=h)continue;
   const a=(y*w+x)*4,b=(fromY*w+fromX)*4;
   for(let k=0;k<4;k++)out[a+k]=original[b+k];
 }
 return out;
}
test('residual co-registration estimates an actual 3-pixel translation in textured data',()=>{
 const before=texture(),after=moved(before,SIZE,SIZE,3,-2);
 // A real construction changed patch must not dictate geometric registration.
 for(let y=85;y<118;y++)for(let x=100;x<134;x++){
   const i=(y*SIZE+x)*4;
   after[i]=248;after[i+1]=242;after[i+2]=210;
 }
 const mask=new Uint8Array(SIZE*SIZE).fill(1);
 const fit=registration.estimateRegistration(before,after,SIZE,SIZE,mask,mask);
 assert.equal(fit.ok,true,JSON.stringify(fit));
 assert.ok(Math.abs(fit.cx[0]-3)<.8,JSON.stringify(fit));
 assert.ok(Math.abs(fit.cy[0]+2)<.8,JSON.stringify(fit));
 assert.ok(fit.rmse<1.25);
 const aligned=registration.warpRGBA(after,SIZE,SIZE,fit,mask);
 assert.equal(aligned.rgba.length,before.length);
 assert.equal(aligned.mask.length,SIZE*SIZE);
 const safe=((150*SIZE+150)*4);
 assert.ok(Math.abs(before[safe]-aligned.rgba[safe])<6);
});
test('limited smooth affine model fits subpixel tilt without a free-form feature warp',()=>{
 const matches=[];
 for(let y=30;y<=230;y+=40)for(let x=30;x<=230;x+=40){
   const u=(x-128)/128,v=(y-128)/128;
   matches.push({x,y,dx:2.0+.85*u-.4*v,dy:-1.5+.5*u+.6*v,similarity:.97});
 }
 const fit=registration.fitAffine(matches,256,256);
 assert.equal(fit.ok,true,JSON.stringify(fit));
 assert.ok(Math.abs(fit.cx[1]-.85)<.12);
 assert.ok(Math.abs(fit.cy[2]-.6)<.12);
});
test('clouded and texture-free satellite surfaces cannot justify any transformation',()=>{
 const before=new Uint8ClampedArray(SIZE*SIZE*4);
 const after=texture();
 const blank=registration.estimateRegistration(before,after,SIZE,SIZE);
 assert.equal(blank.ok,false);
 const mask=new Uint8Array(SIZE*SIZE);
 const cloud=registration.estimateRegistration(after,after,SIZE,SIZE,mask,mask);
 assert.equal(cloud.ok,false);
});
test('unrealistic shifts and spatially confined points are rejected',()=>{
 const shifted=[];
 for(let y=30;y<230;y+=35)for(let x=30;x<230;x+=35)
   shifted.push({x,y,dx:22,dy:0,similarity:.96});
 assert.equal(registration.fitAffine(shifted,256,256).ok,false);
 const grouped=[];
 for(let y=110;y<160;y+=10)for(let x=110;x<160;x+=10)
   grouped.push({x,y,dx:1,dy:1,similarity:.95});
 assert.equal(registration.fitAffine(grouped,256,256).ok,false);
});
test('highlight excludes cloudy source pixels and unobserved warped boundaries',()=>{
 const a=new Uint8ClampedArray([20,30,40,255,80,70,60,255,60,60,60,255]);
 const b=new Uint8ClampedArray([220,230,240,255,80,70,60,255,220,220,220,0]);
 const maskA=new Uint8Array([0,1,1]),maskB=new Uint8Array([1,1,1]);
 const diff=core.rgbDifference(a,b,48,maskA,maskB);
 assert.equal(diff.valid,1);
 assert.equal(diff.changed,0);
 assert.equal(diff.percent,0);
 assert.throws(()=>core.rgbDifference(a,b,48,new Uint8Array(1),maskB));
});

test('Canvas hides the overlay and disables change detection if geometric registration fails',()=>{
 const fs=require('node:fs');
 const path=require('node:path');
 const html=fs.readFileSync(path.resolve(__dirname,'../site/index.html'),'utf8');
 const js=fs.readFileSync(path.resolve(__dirname,'../site/monitor_workspace.js'),'utf8');
 assert.match(html,/id="unregisteredPair"/);
 assert.match(html,/id="alignmentState"/);
 assert.match(html,/src="image_registration.js"/);
 assert.match(js,/showUnregisteredPair\(first,second/);
 assert.match(js,/core\.rgbDifference\([\s\S]*?before\.cloudMask,after\.cloudMask/);
 assert.match(js,/registrationV2\.estimateRegistration\(/);
 assert.match(js,/registrar\.warpRGBA\(/);
});
