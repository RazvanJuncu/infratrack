const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const finish=require('../site/ui_finish.js');
const source=p=>fs.readFileSync(path.join(__dirname,'..','site',p),'utf8');
test('all pages load reversible glass after classic Carbon Sand styles',()=>{
 for(const page of ['index.html','monitor.html','training.html','technical.html']){
  const html=source(page);
  assert.match(html,/src="ui_finish\.js"/);
  assert.match(html,/href="liquid_glass\.css\?v=glass-1"/);
  assert.ok(html.indexOf('liquid_glass.css')>html.indexOf('brand.css'),
    page+' must load glass overrides after existing styling');
  assert.ok(html.indexOf('ui_finish.js')<html.indexOf('liquid_glass.css'),
    page+' must select finish before glass CSS paints');
 }
 const overview=source('index.html');
 assert.ok(overview.indexOf('liquid_glass.css')>overview.indexOf('overview.css'));
});
test('a single local-only setting switches finishes without touching monitored regions',()=>{
 const items=new Map();
 const store={
  getItem:key=>items.get(key)||null,
  setItem:(key,value)=>items.set(key,value)
 };
 const attrs={};
 const root={setAttribute:(key,value)=>attrs[key]=value};
 assert.equal(finish.readFinish(store),'glass');
 assert.equal(finish.setFinish('classic',store,root),'classic');
 assert.equal(attrs['data-ui-finish'],'classic');
 assert.equal(finish.readFinish(store),'classic');
 assert.equal(finish.setFinish('glass',store,root),'glass');
 assert.equal(attrs['data-ui-finish'],'glass');
 assert.deepEqual([...items.keys()],[finish.KEY]);
});
test('corrupt or blocked localStorage gracefully selects Glass',()=>{
 assert.equal(finish.readFinish({getItem:()=>{throw Error('blocked')}}),'glass');
 assert.equal(finish.readFinish({getItem:()=> 'unexpected'}),'glass');
 const root={setAttribute:()=>{}};
 assert.equal(finish.setFinish('classic',{setItem:()=>{throw Error('blocked')}},root),'classic');
});
test('liquid glass rules never replace genuine Sentinel source imagery',()=>{
 const css=source('liquid_glass.css'),js=source('ui_finish.js');
 assert.match(css,/html\[data-ui-finish="glass"\]/);
 assert.match(css,/backdrop-filter:blur\(/);
 assert.match(css,/inset 0 1\.5px 0/);
 assert.match(css,/border-radius:999px/);
 assert.match(css,/rgba\(255,255,255/);
 assert.match(css,/body\.overview-page \.overview-rail/);
 assert.match(css,/body\.overview-page \.overview-detail/);
 assert.match(css,/body\.overview-page #addAreaMap/);
 assert.match(css,/body \.scene-card/);
 assert.match(css,/filter:none!important/);
 assert.doesNotMatch(css,/(?:#canvasViewport|\.preview-container) img\s*\{[^}]*filter:(?:blur|brightness|saturate)/i);
 assert.doesNotMatch(js,/STAC|renderSelected|cached=|sceneIndex|canvas|GeoTIFF/);
 assert.match(js,/aria-pressed/);
 assert.match(js,/finishToggle/);
});
test('accessibility provisions for reduced transparency, motion and no filter support',()=>{
 const css=source('liquid_glass.css');
 assert.match(css,/@media\(prefers-reduced-transparency:reduce\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/@supports not/);
});
