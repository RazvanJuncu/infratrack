/*
 * Quick Review tests require Node's built-in test runner only.
 * All labels are deliberate fixtures, NEVER published as AI ground truth.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 CLASS_NAMES,pixelKey,storageKey,readDrafts,asPayload,nextUnreviewed,countDrafts
}=require('../site/quick_label.js');

const STUDY='a0-nord3-2km-v05',SIG='13e5abfc7a36d6d0';
const points=[{row:10,col:20,id:'review-001'},{row:30,col:45,id:'review-002'},
              {row:80,col:81,id:'review-003'}];
function storageFor(payload){
 const db=new Map([[storageKey(STUDY,SIG),JSON.stringify(payload)]]);
 return {getItem:k=>db.get(k),setItem:(k,v)=>db.set(k,v)};
}
function provisional(point,label){
 return {row:point.row,col:point.col,label,study_id:STUDY,signature:SIG,
         status:'provisional_not_ground_truth',question_version:'change-types-v2',training_eligible:false};
}

test('quick classification has exactly four choices and unsure cannot be trusted ground truth',()=>{
 assert.deepEqual(CLASS_NAMES,['construction','agriculture','unchanged','unsure']);
 const p=asPayload({'10:20':provisional(points[0],'unsure')},STUDY,SIG);
 assert.equal(p.eligible_for_training,false);
 assert.equal(p.verified_count,0);
 assert.equal(p.items[0].training_eligible,false);
 assert.equal(p.items[0].label,'unsure');
});
test('draft remains bound to the exact source-scene signature and study',()=>{
 const p=asPayload({'10:20':provisional(points[0],'construction')},STUDY,SIG);
 const store=storageFor(p);
 assert.equal(Object.keys(readDrafts(store,STUDY,SIG,points)).length,1);
 assert.equal(Object.keys(readDrafts(store,STUDY,'a'.repeat(16),points)).length,0);
 assert.equal(Object.keys(readDrafts(store,'different_study',SIG,points)).length,0);
});
test('provisional data at unauthorized pixels or with forged verified status is rejected',()=>{
 const extraneous=provisional({row:199,col:199},'agriculture');
 const suspect={...provisional(points[1],'construction'),status:'verified_ground_truth'};
 const store=storageFor({type:'provisional_review',study_id:STUDY,signature:SIG,
                   question_version:'change-types-v2',
                   items:[extraneous,suspect,provisional(points[0],'unchanged')]});
 assert.deepEqual(Object.keys(readDrafts(store,STUDY,SIG,points)),['10:20']);
});
test('next candidate finds unreviewed one while unsure counts as reviewed but not verified',()=>{
 const drafts={'10:20':provisional(points[0],'construction'),
               '30:45':provisional(points[1],'unsure')};
 assert.equal(countDrafts(points,drafts),2);
 assert.equal(nextUnreviewed(points,drafts,0),2);
 drafts['80:81']=provisional(points[2],'agriculture');
 assert.equal(nextUnreviewed(points,drafts,2),-1);
 assert.equal(countDrafts(points,drafts),3);
});
test('invalid and corrupt local data do not crash app or become model labels',()=>{
 const store={getItem:()=>'{ invalid json',
              setItem:()=>{throw Error('quota')}};
 assert.deepEqual(readDrafts(store,STUDY,SIG,points),{});
 assert.throws(()=>storageKey(STUDY,'not-a-scene-signature'));
 assert.throws(()=>pixelKey({row:5.3,col:1}));
});

test('old land-type review namespace is isolated from new change reviews',()=>{
 const old=new Map([['infratrack:quick-review:v1:'+STUDY+':'+SIG,
    JSON.stringify({type:'provisional_review',study_id:STUDY,signature:SIG,
      items:[{...provisional(points[0],'agriculture'),question_version:undefined}]})]]);
 const storage={getItem:key=>old.get(key)||null};
 assert.equal(Object.keys(readDrafts(storage,STUDY,SIG,points)).length,0);
 assert.match(storageKey(STUDY,SIG),/v2:change-types:/);
});
test('old draft payload at new key is rejected without version',()=>{
 const old={type:'provisional_review',study_id:STUDY,signature:SIG,
   items:[{...provisional(points[0],'unchanged'),question_version:undefined}]};
 assert.equal(Object.keys(readDrafts(storageFor(old),STUDY,SIG,points)).length,0);
});
