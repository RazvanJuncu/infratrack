const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const extraction=require('../site/extraction_link.js');
const read=file=>fs.readFileSync(path.resolve(__dirname,'../site',file),'utf8');
const viewport={width:1440,height:900};
test('real screen footprint connects with the side of the preview',()=>{
 const box={left:420,right:630,top:300,bottom:510};
 const preview={left:1100,right:1370,top:240,bottom:650};
 const g=extraction.geometry(box,preview,viewport);
 assert.equal(g.direction,'right');
 assert.match(g.top,/630 300 L 1100 240/);
 assert.match(g.bottom,/630 510 L 1100 650/);
});
test('hide connector when area cannot be spatially attached',()=>{
 const target={left:1100,right:1300,top:200,bottom:540};
 assert.equal(extraction.geometry({left:10,right:20,top:80,bottom:91},target,viewport),null);
 assert.equal(extraction.geometry({left:600,right:1200,top:300,bottom:500},target,viewport),null);
 assert.equal(extraction.geometry({left:-600,right:-40,top:300,bottom:450},target,viewport),null);
 assert.equal(extraction.geometry({left:100,right:200,top:300,bottom:450},target,{width:0,height:800}),null);
});
test('draw thin guidelines, no luminous cone or glare',()=>{
 const css=read('overview.css');
 assert.match(css,/#extractionBeam\{display:none\}/);
 assert.match(css,/\.extraction-edge\{[\s\S]*?stroke-width:1\.35/);
 assert.doesNotMatch(css,/drop-shadow\(/);
 assert.doesNotMatch(css,/clip-path:inset/);
 assert.match(css,/@media\(max-width:850px\)/);
});
test('Overview updates selected connector on pan, zoom and responsive layout',()=>{
 const js=read('overview.js'),html=read('index.html');
 assert.match(js,/extraction\.geometry\(source,target,frame\)/);
 assert.match(js,/map\.on\("move zoom zoomanim moveend zoomend resize",scheduleExtraction\)/);
 assert.match(js,/new root\.ResizeObserver\(scheduleExtraction\)/);
 assert.match(js,/cancelPreview\(\);clearExtraction\(\)/);
 assert.match(html,/id="areaExtraction"/);
 assert.match(html,/src="extraction_link\.js"/);
});
