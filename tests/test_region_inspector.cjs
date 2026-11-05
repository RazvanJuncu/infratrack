const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const inspector=require('../site/region_inspector.js');
function region(){return {id:7,pixels:16,meanDelta:61.2}}
const base={haveSCL:true,haveRGB:true,shadowFraction:0,
 cloudAdjacentFraction:0,cloudShadowAdjacentFraction:0};
test('not enough evidence does not hallucinate industrial or crop classification',()=>{
 const d=inspector.interpretRegion(region(),base);
 assert.equal(d.hypothesis,'Unclassified visual change');
 assert.equal(d.unverified,true);
 assert.doesNotMatch(d.hypothesis,/industrial|construction|crop/i);
 assert.match(d.limitation,/not AI confidence/);
});
test('measured vegetation-index growth adds a tentative vegetation interpretation',()=>{
 const d=inspector.interpretRegion(region(),base,{status:'measured',delta:.28});
 assert.equal(d.hypothesis,'Possible vegetation growth');
 assert.match(d.alternative,/Crop growth/);
 assert.equal(d.evidenceLevel,'RGB + B04/B08 reflectance');
});
test('NDVI loss can be harvest or clearing; do not call it construction',()=>{
 const d=inspector.interpretRegion(region(),base,{status:'measured',delta:-.27});
 assert.equal(d.hypothesis,'Possible harvest or vegetation loss');
 assert.match(d.alternative,/industrial development is not established/);
});
test('strong real SCL cloud adjacency takes priority over apparent NDVI change',()=>{
 const d=inspector.interpretRegion(region(),{...base,cloudAdjacentFraction:.45},
  {status:'measured',delta:.2});
 assert.equal(d.hypothesis,'Possible cloud-edge artefact');
 assert.match(d.alternative,/not classified as clouds/);
});
test('actual SCL shadow pixels support a separate warning',()=>{
 const d=inspector.interpretRegion(region(),{...base,cloudShadowAdjacentFraction:.3});
 assert.equal(d.hypothesis,'Possible cloud-shadow influence');
});
test('RGB-only shadows have an explicit false-positive warning',()=>{
 const d=inspector.interpretRegion(region(),{...base,shadowFraction:.8});
 assert.equal(d.hypothesis,'Possible shadow / illumination change');
});
test('persistent surface modification is tentative and requires multiple data sources',()=>{
 const d=inspector.interpretRegion(region(),base,{status:'measured',delta:.02},
  {status:'signal_still_visible'});
 assert.equal(d.hypothesis,'Possible persistent surface modification');
 assert.match(d.alternative,/industrial activity are possible/);
 assert.equal(d.unverified,true);
});
test('short-lived RGB variation is not reported as industrial development',()=>{
 const d=inspector.interpretRegion(region(),base,null,{status:'not_correlated'});
 assert.equal(d.hypothesis,'Possibly transient visual change');
});
test('region SCL quality uses actual masked cloud and cloud-shadow categories near region',()=>{
 const w=8,h=8,n=w*h,labels=new Uint16Array(n);
 const sclA=new Uint8Array(n).fill(4),sclB=new Uint8Array(n).fill(5);
 const a=new Uint8ClampedArray(n*4),b=new Uint8ClampedArray(n*4);
 for(let y=3;y<5;y++)for(let x=3;x<5;x++){
  const p=y*w+x;labels[p]=7;
  a.set([120,120,120,255],p*4);b.set([65,65,65,255],p*4);
 }
 sclB[3*w+2]=9; // high-confidence cloud just outside change
 sclA[2*w+3]=3; // classified cloud shadow just outside change
 const q=inspector.regionQuality({labels},region(),w,h,a,b,sclA,sclB);
 assert.equal(q.pixels,4);
 assert.ok(q.cloudAdjacentFraction>.2);
 assert.ok(q.cloudShadowAdjacentFraction>.2);
 assert.equal(q.shadowFraction,1);
});
test('missing raw SCL never gets a false cloud classification',()=>{
 const w=8,h=8,labels=new Uint16Array(w*h).fill(7);
 const q=inspector.regionQuality({labels},region(),w,h,null,null,null,null);
 assert.equal(q.haveSCL,false);
 const d=inspector.interpretRegion(region(),q);
 assert.equal(d.hypothesis,'Unclassified visual change');
});
test('monitor exposes selection from both canvas and list, with one NDVI on-demand request',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../site/monitor.html'),'utf8');
 const js=fs.readFileSync(path.resolve(__dirname,'../site/monitor_workspace.js'),'utf8');
 assert.match(html,/src="region_inspector.js"/);
 for(const id of ['regionInspector','regionInspectorIndex','regionInspectorHypothesis',
  'regionInspectorWhy','regionInspectorAlternative','regionInspectorFacts'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/viewport\.addEventListener\("click"/);
 assert.match(js,/selectChangeRegion\(activeChange,id,w,h\)/);
 assert.match(js,/item\.onclick=\(\)=>selectChangeRegion\(/);
 assert.match(js,/autoNDVIRequested=true;void inspectNDVI\(\)/);
 assert.match(js,/regionInspectorEngine\.regionQuality\(/);
 assert.match(js,/regionInspectorEngine\.interpretRegion\(/);
});
