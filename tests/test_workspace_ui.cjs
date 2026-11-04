/* InfraTrack v0.9 workspace regression tests — Node built-in runner. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../site/monitor_workspace_core.js');
const preview=require('../site/custom_preview.js');
const sample=(id,date,cloud,bbox=[25.8,44.2,26.2,44.6])=>({
 id,bbox,properties:{datetime:date+'T08:00:00Z','eo:cloud_cover':cloud},
 assets:{visual:{href:'https://example.org/sentinel/'+id+'.tif'}}
});
const area={id:'custom-123',name:'My study',lat:44.42,lon:26.03,size_km:2,
            type:'construction'};
test('European watchlist can reuse v0.8 local saved areas',()=>{
 assert.equal(core.validSaved(area),true);
 assert.equal(core.validSaved({...area,lat:90}),false);
 const saved={getItem:()=>JSON.stringify([area,area,{...area,id:'custom-124'}])};
 assert.equal(core.readSaved(saved).length,2);
 const b=core.bounds(area);
 assert.ok(b[0]<area.lon&&b[2]>area.lon);
});
test('timeline keeps unique actual dates and prefers complete and visual scenes',()=>{
 const sources=[sample('partial','2026-10-04',0,[26.03,44.3,26.05,44.5]),
                sample('correct','2026-10-04',12),
                sample('older','2026-09-09',0),
                sample('cloud','2026-11-03',99)];
 const selected=core.catalogScenes(sources,area);
 assert.deepEqual(selected.map(x=>x.id),['cloud','correct','older']);
 assert.equal(core.sceneCloud(selected[0]),99);
 assert.equal(core.cloudAlert(selected,[selected[1],selected[2]]).includes('99%'),true);
});
test('dragging and clicking: one scene fills Canvas, two display chronologically',()=>{
 const lookup=new Map([['newer',sample('newer','2026-10-04',0)],
                       ['older',sample('older','2026-09-09',5)]]);
 let slots={before:null,after:null};
 slots=core.dropInto(slots,'after','newer');
 assert.deepEqual(core.pairFrom(slots,lookup).map(x=>x.id),['newer']);
 slots=core.dropInto(slots,'before','older');
 assert.deepEqual(core.pairFrom(slots,lookup).map(x=>x.id),['older','newer']);
 slots=core.removeFrom(slots,'after');
 assert.deepEqual(core.pairFrom(slots,lookup).map(x=>x.id),['older']);
 slots=core.addByClick(slots,'newer');
 assert.deepEqual(core.pairFrom(slots,lookup).map(x=>x.id),['older','newer']);
 slots=core.removeFrom(slots,'before');
 assert.deepEqual(core.pairFrom(slots,lookup).map(x=>x.id),['newer']);
});
test('drop payload requires the currently selected area',()=>{
 const d=core.payload('my-scene','custom-123');
 assert.equal(core.parsePayload(d,'custom-123'),'my-scene');
 assert.equal(core.parsePayload(d,'custom-124'),null);
 assert.equal(core.parsePayload('not-json','custom-123'),null);
 assert.equal(core.sliderClip(50),'inset(0 50% 0 0)');
});
test('experimental raw visual difference never claims trained AI',()=>{
 const a=new Uint8ClampedArray([75,80,80,255,40,40,40,255,0,0,0,255]);
 const b=new Uint8ClampedArray([90,90,90,255,200,210,200,255,255,255,255,255]);
 const diff=core.rgbDifference(a,b,48);
 assert.equal(diff.valid,2);
 assert.equal(diff.changed,1);
 assert.equal(diff.percent,50);
 assert.match(diff.model,/Untrained/);
 assert.equal(diff.rgba[7]>0,true);
 assert.throws(()=>core.rgbDifference(a,new Uint8ClampedArray(4)));
});
test('selected dated scene is not silently changed for preview',()=>{
 const older=sample('older','2026-09-09',0);
 const newer=sample('newer','2026-10-04',0);
 const list=preview.exactSelection([newer,older]);
 assert.deepEqual(list.map(x=>x.id),['older','newer']);
});
test('UI references exist in v0.9 HTML',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../site/index.html'),'utf8');
 const js=fs.readFileSync(path.resolve(__dirname,'../site/monitor_workspace.js'),'utf8');
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...js.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(refs)].filter(id=>!ids.has(id)),[]);
 assert.match(html,/id="timelineScroll"/);
 assert.match(html,/id="canvasViewport"/);
 assert.match(html,/id="removeDrop"/);
 assert.match(html,/id="compareRange"/);
});


test('RGBA highlighting accepts real 8-bit buffers without depending on realm-specific constructor',async()=>{
 const src={width:2,height:2,rgba:new Uint8Array(16)};
 src.rgba.set([120,50,60,255],0);
 const pixels=await core.alignedRGBA(src,()=>{throw Error('Should not decode image')});
 assert.ok(pixels instanceof Uint8ClampedArray);
 assert.equal(pixels.length,16);
 assert.equal(pixels[0],120);
});
test('highlight reconstructs exact aligned bytes from an existing data PNG if raw buffer was omitted',async()=>{
 const expected=new Uint8ClampedArray([25,40,50,255,100,100,110,255,0,0,0,255,150,140,130,255]);
 const scene={width:2,height:2,image:'data:image/png;base64,fixture'};
 let used=false;
 const decoded=await core.alignedRGBA(scene,async (image,w,h)=>{
   assert.equal(image,scene.image);assert.equal(w,2);assert.equal(h,2);
   used=true;return expected;
 });
 assert.equal(used,true);
 assert.deepEqual([...decoded],[...expected]);
 const compared=core.rgbDifference(decoded,decoded,48);
 assert.equal(compared.changed,0);
});
test('invalid preview bytes and dimension mismatch remain hard failures',async()=>{
 await assert.rejects(core.alignedRGBA({width:3,height:3,rgba:[1,2,3]},null),/unavailable|dimensions|backup/);
 await assert.rejects(core.alignedRGBA({width:2,height:2,image:'data:image/png;base64,a'},
   async()=>new Uint8ClampedArray(3)),/dimensions/);
});
