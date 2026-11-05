/* Map-first Overview: real satellite acquisition, shared watchlist and routing. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../site/monitor_workspace_core.js');
const overview=require('../site/overview.js');
const read=p=>fs.readFileSync(path.resolve(__dirname,'../site',p),'utf8');
const area={id:'a0-nord-lot3',lat:44.5065,lon:26.2328,size_km:2,name:'A0'};
function scene(id,day,cloud,assets=true){
 const bbox=core.bounds(area);
 return {id,bbox,properties:{datetime:day+'T10:00:00Z','eo:cloud_cover':cloud},
  assets:assets?{visual:{href:'https://test.example/'+id+'.tif'}}:{}};
}
test('homepage is geographic Overview and existing Canvas is an intact separate workspace',()=>{
 const home=read('index.html'),monitor=read('monitor.html');
 assert.match(home,/<title>InfraTrack · Overview/);
 for(const id of ['overviewMap','overviewAreaList','overviewDetail','detailImage',
  'openWorkspace','addAreaMap','newAreaName','newAreaType','saveNewArea']){
  assert.ok(home.includes('id="'+id+'"'),'missing home ID '+id);
 }
 for(const id of ['canvasViewport','canvasOld','canvasNew','timelineScroll','regionInspector',
  'highlightBtn','compareRange','slotBefore','slotAfter']){
  assert.ok(monitor.includes('id="'+id+'"'),'missing Canvas ID '+id);
 }
 assert.match(home,/src="overview.js"/);
 assert.match(monitor,/src="monitor_workspace.js"/);
 assert.match(home,/href="monitor.html"/);
 assert.match(monitor,/href="\.\/"[^>]*>Overview/);
});
test('overview combines registered + private browser areas without duplicates',()=>{
 const saved={id:'custom-123-456',name:'Field',lat:44.5,lon:26.2,size_km:2};
 const both=overview.mergeAreas([area,{...area,name:'Duplicate'}],[saved,area]);
 assert.deepEqual(both.map(x=>x.id),['a0-nord-lot3','custom-123-456']);
 assert.equal(both[0].category,'registered');
 assert.equal(both[1].category,'saved');
 assert.equal(overview.activeLink(saved),'monitor.html?site=custom-123-456');
 assert.deepEqual(overview.positionRect(saved).length,2);
});
test('ISO UTC acquisition date is readable but chronology stays stable',()=>{
 assert.equal(core.humanDate('2026-12-13'),'13 Dec 2026');
 assert.equal(core.humanDate('2026-01-02'),'2 Jan 2026');
 assert.equal(core.humanDate('2026-02-30'),null);
 assert.deepEqual(core.timelineGroup('2026-12-13'),
  {year:'2026',month:'2026-12',monthName:'December'});
 assert.equal(overview.dateLabel('2026-12-13'),'13 Dec 2026');
 const monitorJs=read('monitor_workspace.js');
 assert.match(monitorJs,/core\.timelineGroup\(dayText\(scene\)\)/);
 assert.match(monitorJs,/displayDate\(dayText\(scene\)\)/);
 assert.match(monitorJs,/classList\.add\("bad"\)/);
 assert.match(monitorJs,/scene-cloud-icon/);
});
test('preview ranks genuine dated COG scenes and skips extremely cloudy/missing imagery',()=>{
 const list=[
  scene('old','2026-10-10',10),
  scene('very-cloudy','2026-11-03',99),
  scene('new-usable','2026-10-21',55),
  scene('no-visual','2026-10-30',5,false)
 ];
 const ranked=overview.previewCandidates(list,area);
 assert.deepEqual(ranked.map(s=>s.id),['new-usable','old']);
});
test('new areas reuse validated original 2 km watchlist rather than inventing cloud or site history',()=>{
 const js=read('overview.js');
 assert.match(js,/core\.validSaved\(area\)/);
 assert.match(js,/root\.localStorage\.setItem\(core\.KEY/);
 assert.match(js,/root\.L\.rectangle\(positionRect\(/);
 assert.match(js,/root\.L\.marker\(/);
 assert.match(js,/map\.on\("click",mapClicked\)/);
 assert.match(js,/preview\.renderSelected\(area,\[item\]/);
 assert.match(js,/requireLocalScreening:true/);
 assert.match(js,/minClear:\.65/);
 assert.match(js,/selectedPreviewCache\.set\(area\.id,result\)/);
 assert.match(js,/new AbortController\(\)/);
 assert.match(js,/checked>=8/);
 assert.doesNotMatch(js,/generate.*fake.*satellite/i);
});
test('basemap source is distinct from true historical Sentinel crop and source attribution is visible',()=>{
 const js=read('overview.js'),home=read('index.html');
 assert.match(js,/World_Imagery\/MapServer\/tile/);
 assert.match(js,/OpenStreetMap contributors/);
 assert.match(js,/Earthstar Geographics/);
 assert.match(home,/The overview basemap is for orientation/);
 assert.match(home,/preview.*Sentinel-2/i);
});
test('Carbon Sand overview keeps panels square and interactive controls round',()=>{
 const css=read('overview.css');
 assert.match(css,/\.overview-rail\{/);
 assert.match(css,/\.overview-detail\{/);
 assert.match(css,/border-radius:999px/);
 assert.match(css,/\[hidden\]\{display:none!important\}/);
 assert.match(css,/prefers-reduced-motion/);
 const nav=read('training.html');
 assert.match(nav,/href="monitor.html">Monitor/);
 assert.match(nav,/href="\.\/">Overview/);
});
