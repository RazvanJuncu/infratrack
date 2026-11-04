/* Technical v0.8 imports current published metadata, never legacy-only data. */
const test=require('node:test');
const assert=require('node:assert/strict');
const technical=require('../site/technical_app.js');
test('technical portfolio aggregates only declared ready sites',()=>{
 const project={sites:[{id:'a0-nord-lot3',status:'ready'},
                       {id:'a7-ramnicu-sud',status:'ready'},
                       {id:'a1-tigveni',status:'unavailable'}]};
 const recent={sites:[{id:'a0-nord-lot3',status:'ready',candidate_count:12},
                      {id:'a7-ramnicu-sud',status:'insufficient_clear_observations',candidate_count:0},
                      {id:'made-up-project',status:'ready',candidate_count:99}]};
 const stats=technical.portfolioStats(project,recent);
 assert.deepEqual(stats,{total:3,processed:2,recent_ready:1,significant_candidates:12});
});
test('verified construction is never inferred from spectral candidate queue',()=>{
 const queue={status:'unverified_recent_changes',study_id:'a0-nord-lot3',
   items:[{row:40,col:10,lat:44.5,lon:26.2,signal_strength:.51},
          {row:-1,col:10,lat:44.5,lon:26.2,signal_strength:1.0},
          {row:30,col:22,lat:44.51,lon:26.22,signal_strength:.3}]};
 assert.equal(technical.safeCandidates(queue,'a0-nord-lot3').length,2);
 assert.equal(technical.safeCandidates(queue,'other-region').length,0);
});
test('technical prefers recent actual image pair and distinctly labels historical fallback',()=>{
 const site={id:'a0-nord-lot3'};
 const recent={status:'ready',before_date:'2026-10-01',after_date:'2026-10-11'};
 const history={status:'ready',before:{date:'2023-08-03'},after:{date:'2025-08-14'}};
 const a=technical.asPair(site,recent,history);
 assert.equal(a.isRecent,true);
 assert.deepEqual(a.dates,['2026-10-01','2026-10-11']);
 assert.match(a.images[0],/recent_before\.png$/);
 const b=technical.asPair(site,{status:'unavailable'},history);
 assert.equal(b.isRecent,false);
 assert.match(b.source,/Historical fallback/);
 assert.equal(technical.asPair(site,{status:'unavailable'},null),null);
});
test('technical does not accept path traversal as a study folder',()=>{
 assert.equal(technical.siteFolder('../private'),null);
 assert.equal(technical.siteFolder('a1-tigveni'),'projects/a1-tigveni/');
});
