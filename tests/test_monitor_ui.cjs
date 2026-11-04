const test=require('node:test');
const assert=require('node:assert/strict');
const monitor=require('../site/monitor_app.js');
const quiz=require('../site/training_recent.js');

test('a user can select European lat lon without hardcoded Romanian CRS',()=>{
 assert.equal(monitor.allowed(48.8584,2.2945),true);
 assert.equal(monitor.allowed(52.52,13.405),true);
 assert.equal(monitor.allowed(40.4,-3.7),true);
 assert.equal(monitor.allowed(40,-75),false);
 const bb=monitor.bounds(48.8584,2.2945);
 assert.ok(bb[0]<2.2945&&bb[2]>2.2945);
 assert.ok(bb[1]<48.8584&&bb[3]>48.8584);
});
test('STAC search covers precisely the area and preserves source dates',()=>{
 const body=monitor.searchBody({lat:48.8584,lon:2.2945,size_km:2},30,
              new Date('2026-11-04T12:00:00Z'));
 assert.equal(body.collections[0],'sentinel-2-c1-l2a');
 assert.equal(body.datetime,'2026-10-05T00:00:00Z/2026-11-04T23:59:59Z');
 const sources=monitor.parseScenes({features:[
  {id:'x',properties:{datetime:'2026-11-01T10:00:00Z','eo:cloud_cover':12}},
  {id:'y',properties:{datetime:'2026-11-01T12:00:00Z','eo:cloud_cover':25}},
  {id:'z',properties:{datetime:'2026-10-15T10:00:00Z','eo:cloud_cover':45}}
 ]},30,new Date('2026-11-04T12:00:00Z'));
 assert.equal(sources.length,2);
 assert.equal(sources[0].id,'y');
 assert.equal(sources[0].cloud_percent,25);
});
test('custom area storage rejects invalid or out-of-Europe locations',()=>{
 const valid={id:'custom-123',name:'Study',lat:52.52,lon:13.4,size_km:2,type:'construction'};
 const store={getItem:()=>JSON.stringify([valid,{...valid,id:'custom-124',lat:100}])};
 assert.equal(monitor.readSaved(store).length,1);
 assert.equal(monitor.validCustom(valid),true);
});
const it={id:'a1-recent-01',study_id:'a1-sample',signature:'abcdef0123456789'};
function entry(){return {item_id:it.id,study_id:it.study_id,signature:it.signature,
 label:'construction',confidence:'medium',
 status:'unverified_visual_review',training_eligible:false};}
test('new recent Q&A is not training ground truth and scene-specific',()=>{
 const valid=entry();
 assert.equal(quiz.validRecord(valid,it),true);
 assert.equal(quiz.validRecord({...valid,training_eligible:true},it),false);
 assert.equal(quiz.validRecord({...valid,confidence:'unspecified'},it),false);
 const store={getItem:(k)=>k===quiz.key(it)?JSON.stringify(valid):null};
 const batch=quiz.exportDrafts([it],store);
 assert.equal(batch.items.length,1);
 assert.equal(batch.eligible_for_training,false);
 assert.equal(batch.verified_count,0);
 assert.equal(quiz.nextUnreviewed([it],store,0),-1);
});
test('recent Q&A excludes fabricated legacy v2 labels',()=>{
 const store={getItem:()=>JSON.stringify({item_id:it.id,study_id:it.study_id,signature:it.signature,
 label:'agriculture',status:'provisional_not_ground_truth',training_eligible:false})};
 assert.equal(quiz.loadDraft(store,it),null);
});


const preview=require('../site/custom_preview.js');

test('custom on-demand preview accepts actual European UTM projections',()=>{
 assert.equal(preview.isUTM(32631),true);
 assert.equal(preview.isUTM(32635),true);
 assert.equal(preview.isUTM(32735),true);
 assert.equal(preview.isUTM(4326),false);
 assert.match(preview.UTMDefinition(32631),/zone=31/);
 const bbox=preview.geoBounds({lat:48.8584,lon:2.2945,size_km:2});
 assert.ok(bbox[2]>bbox[0]&&bbox[3]>bbox[1]);
});
test('preview rejects scenes without actual visual COGs and selects recent acquisition days',()=>{
 const item=(id,date,cloud,visual)=>({
  id,properties:{datetime:date+'T10:00:00Z','eo:cloud_cover':cloud},
  assets:visual?{visual:{href:'https://example.com/'+id+'.tif'}}:{thumbnail:{href:'https://example.com/'+id+'.jpg'}}
 });
 const scenes=preview.chooseItems([
   item('older','2026-10-10',10,true),
   item('cloudy','2026-10-22',90,true),
   item('recent','2026-10-29',35,true),
   item('thumbnail','2026-10-31',5,false)
 ],90,new Date('2026-11-04T12:00:00Z'));
 assert.deepEqual(scenes.map(x=>x.id),['recent','older']);
});
test('preview aligns geographic crop to COG pixel coordinate window',()=>{
 const img={
  getOrigin:()=>[500000,5200000],
  getResolution:()=>[10,-10],
  getWidth:()=>11000,getHeight:()=>11000
 };
 assert.deepEqual(preview.pixelWindow(img,[500100,5199700,500300,5199900]),
   [10,10,30,30]);
 assert.throws(()=>preview.pixelWindow(img,[490000,5199700,500300,5199900]));
});
test('local scene classification excludes clouds',()=>{
 assert.equal(preview.localClear([4,5,6,7,8,9]),.5);
 assert.equal(preview.localClear([]),0);
});
