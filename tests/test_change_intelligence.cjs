const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const engine=require('../site/change_intelligence.js');
const reg=require('../site/registration_v2.js');
function scene(w,h,fn){
 const a=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)
  a.set([...fn(x,y),255],(y*w+x)*4);
 return a;
}
test('one 8x8 changed patch forms one unverified region',()=>{
 const w=32,h=32,mask=new Uint8Array(w*h).fill(1);
 const a=scene(w,h,()=>[70,80,75]);
 const b=scene(w,h,(x,y)=>x>=8&&x<16&&y>=8&&y<16?[201,199,192]:[70,80,75]);
 const result=engine.segment(a,b,w,h,mask,mask);
 assert.equal(result.totalRegions,1);
 assert.equal(result.candidatePixels,64);
 assert.deepEqual(result.regions[0].bbox,{x:8,y:8,width:8,height:8});
});
test('illumination and isolated noise do not trigger regions',()=>{
 const w=32,h=32,mask=new Uint8Array(w*h).fill(1);
 const a=scene(w,h,()=>[70,80,75]);
 const light=scene(w,h,()=>[85,95,90]);
 const noise=scene(w,h,(x,y)=>x===11&&y===11?[220,220,220]:[70,80,75]);
 assert.equal(engine.segment(a,light,w,h,mask,mask).totalRegions,0);
 assert.equal(engine.segment(a,noise,w,h,mask,mask).totalRegions,0);
});
test('clouds mask changes and missing masks fail closed',()=>{
 const w=32,h=32,clear=new Uint8Array(w*h).fill(1),masked=clear.slice();
 const a=scene(w,h,()=>[70,80,75]);
 const b=scene(w,h,(x,y)=>x>=8&&x<16&&y>=8&&y<16?[201,199,192]:[70,80,75]);
 for(let y=8;y<16;y++)for(let x=8;x<16;x++)masked[y*w+x]=0;
 assert.equal(engine.segment(a,b,w,h,clear,masked).totalRegions,0);
 assert.throws(()=>engine.segment(a,b,w,h,clear,null),/cloud masks/);
});
test('rigid fallback rejects excessive shifts and confined features',()=>{
 const p=[];
 for(let y=20;y<230;y+=50)for(let x=20;x<230;x+=50)
  p.push({x,y,dx:2,dy:-2,similarity:.95});
 assert.equal(reg.rigidConsensus(p,256,256).ok,true);
 assert.equal(reg.rigidConsensus(p.map(q=>({...q,dx:11})),256,256).ok,false);
 assert.equal(reg.rigidConsensus(p.map(q=>({...q,x:120+q.x/40,y:120+q.y/40})),256,256).ok,false);
});
test('Monitor has new engines and retains fail-closed behavior',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../site/index.html'),'utf8');
 const js=fs.readFileSync(path.resolve(__dirname,'../site/monitor_workspace.js'),'utf8');
 assert.match(html,/src="registration_v2.js"/);
 assert.match(html,/src="change_intelligence.js"/);
 assert.match(html,/id="changeEvents"/);
 assert.match(js,/registrationV2\.estimateRegistration\(/);
 assert.match(js,/changeEngine\.segment\(/);
 assert.match(js,/showUnregisteredPair[\s\S]*?resetChangeRegions\(/);
});
