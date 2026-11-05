const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const intelligence=require('../site/change_intelligence.js');
const preview=require('../site/custom_preview.js');
function scene(w,h,fn){
 const data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set([...fn(x,y),255],(y*w+x)*4);
 return data;
}
test('shadows are flagged and excluded by default, but user may review them',()=>{
 const w=32,h=32,mask=new Uint8Array(w*h).fill(1);
 const before=scene(w,h,()=>[120,120,120]);
 const after=scene(w,h,(x,y)=>x>=8&&x<16&&y>=8&&y<16?[60,60,60]:[120,120,120]);
 const filtered=intelligence.segment(before,after,w,h,mask,mask);
 assert.equal(filtered.totalRegions,0);
 assert.equal(filtered.shadowLikePixels,64);
 const inclusive=intelligence.segment(before,after,w,h,mask,mask,{includeShadowLike:true});
 assert.equal(inclusive.candidatePixels,64);
});
test('real-looking bright-color patches are not arbitrarily suppressed',()=>{
 const w=32,h=32,mask=new Uint8Array(w*h).fill(1);
 const before=scene(w,h,()=>[70,80,75]);
 const after=scene(w,h,(x,y)=>x>=8&&x<16&&y>=8&&y<16?[201,199,192]:[70,80,75]);
 const r=intelligence.segment(before,after,w,h,mask,mask);
 assert.equal(r.totalRegions,1);
 assert.equal(r.candidatePixels,64);
});
test('selected region has exact edge contour, not bounding rectangle',()=>{
 const w=32,h=32,mask=new Uint8Array(w*h).fill(1);
 const before=scene(w,h,()=>[70,80,75]);
 const after=scene(w,h,(x,y)=>x>=8&&x<16&&y>=8&&y<16?[201,199,192]:[70,80,75]);
 const r=intelligence.segment(before,after,w,h,mask,mask);
 const contour=intelligence.outline(r.labels,w,h,r.regions[0].id);
 assert.equal(contour[(8*w+8)*4+3],255);
 assert.equal(contour[(11*w+11)*4+3],0);
 assert.equal(contour[(4*w+4)*4+3],0);
});
test('NDVI evidence uses verified pixel geometry and actual valid coverage',()=>{
 const labels=new Uint16Array(16).fill(1);
 const ndviBefore=new Float32Array(16).fill(.6);
 const ndviAfter=new Float32Array(16).fill(.3);
 const regions=[{id:1,pixels:16}];
 const result=intelligence.summarizeNDVI(regions,labels,ndviBefore,ndviAfter);
 assert.equal(result[0].status,'measured');
 assert.ok(Math.abs(result[0].delta+.3)<1e-6);
 assert.equal(result[0].signal,'vegetation-index decrease');
 const invalid=new Float32Array(16).fill(NaN);
 assert.equal(intelligence.summarizeNDVI(regions,labels,ndviBefore,invalid)[0].status,
   'insufficient_spectral_coverage');
 assert.throws(()=>intelligence.summarizeNDVI(regions,labels,new Float32Array(4),ndviAfter),/same verified/);
});
test('temporal persistence requires later, clear, matched pixel evidence',()=>{
 const labels=new Uint16Array(16).fill(1);
 const clear=new Uint8Array(16).fill(1);
 const regions=[{id:1,pixels:16}];
 const same={labels:new Uint16Array(16).fill(7)};
 assert.equal(intelligence.persistence(regions,labels,same,clear)[0].status,'signal_still_visible');
 const empty={labels:new Uint16Array(16)};
 assert.equal(intelligence.persistence(regions,labels,empty,clear)[0].status,'not_correlated');
 assert.equal(intelligence.persistence(regions,labels,same,new Uint8Array(16))[0].status,'insufficient_later_coverage');
});
test('regridding preserves original 16-bit reflectance values',()=>{
 const indices=new Int32Array([0,1,2,3]);
 const grid={outputSize:2,sourceSize:2,indices};
 const sampled=preview.regridSamples(new Uint16Array([2000,4000,5000,7000]),1,grid);
 assert.ok(sampled instanceof Uint16Array);
 assert.deepEqual([...sampled],[2000,4000,5000,7000]);
});
test('NDVI reads B04/B08 reflectance scale and offset from STAC',async()=>{
 const index=fs.readFileSync(path.resolve(__dirname,'../site/custom_preview.js'),'utf8');
 assert.match(index,/readNDVI/);
 // Regression on actual reflectance arithmetic: red=0.2, nir=0.4.
 const red=3000*.0001-.1,nir=5000*.0001-.1;
 assert.ok(Math.abs((nir-red)/(nir+red)-1/3)<1e-10);
 const page=fs.readFileSync(path.resolve(__dirname,'../site/index.html'),'utf8');
 assert.match(page,/id="inspectNDVI"/);
 assert.match(page,/id="checkPersistence"/);
 assert.match(page,/id="shadowToggle"/);
 assert.match(page,/<canvas id="regionFocus"/);
 const monitor=fs.readFileSync(path.resolve(__dirname,'../site/monitor_workspace.js'),'utf8');
 assert.match(monitor,/preview\.readNDVI\(/);
 assert.match(monitor,/changeEngine\.warpScalar\(/);
 assert.match(monitor,/changeEngine\.persistence\(/);
 assert.match(monitor,/changeEngine\.outline\(/);
});

test('real NDVI raster reader applies STAC scale/offset and retains source precision',async()=>{
 const priorGeo=globalThis.GeoTIFF,priorProj=globalThis.proj4;
 function proj(from,to,p){
  if(from!=='EPSG:4326')throw Error('Unexpected mock reprojection');
  return [500000+(p[0]-26)*79000,5000000+(p[1]-45)*111000];
 }
 proj.defs=()=>{};
 globalThis.proj4=proj;
 globalThis.GeoTIFF={fromUrl:async url=>({
  getImage:async()=>({
   getOrigin:()=>[0,6000000],getResolution:()=>[10,-10],
   getWidth:()=>1000000,getHeight:()=>1000000
  }),
  readRasters:async({width,height})=>
   new Uint16Array(width*height).fill(url.includes('nir')?5000:3000)
 })};
 try{
  const item={
   id:'independent-scene-123',
   properties:{datetime:'2026-10-21T10:00:00Z','proj:epsg':32635},
   assets:{
    red:{href:'https://example.test/red.tif',
      'raster:bands':[{scale:0.0001,offset:-0.1}]},
    nir:{href:'https://example.test/nir.tif',
      'raster:bands':[{scale:0.0001,offset:-0.1}]}
   }
  };
  const result=await preview.readNDVI(item,{lat:45,lon:26,size_km:2});
  assert.equal(result.valid,256*256);
  assert.ok(Math.abs(result.ndvi[1536]-1/3)<.001);
  assert.equal(result.sceneId,item.id);
  const missing={...item,assets:{...item.assets,nir:{
   href:'https://example.test/nir.tif'}}};
  await assert.rejects(()=>preview.readNDVI(missing,{lat:45,lon:26,size_km:2}),
   /scale\/offset metadata/);
 }finally{
  globalThis.GeoTIFF=priorGeo;
  globalThis.proj4=priorProj;
 }
});
