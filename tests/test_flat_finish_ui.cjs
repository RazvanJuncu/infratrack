const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=file=>fs.readFileSync(path.resolve(__dirname,'../site',file),'utf8');
test('all four pages ship only the matte finish, no Liquid Glass toggle',()=>{
 for(const name of ['index.html','monitor.html','training.html','technical.html']){
  const html=src(name);
  assert.match(html,/href="flat_finish\.css\?v=flat-1"/);
  assert.doesNotMatch(html,/liquid_glass\.css|ui_finish\.js|finishToggle/);
  assert.ok(html.indexOf('flat_finish.css')>html.indexOf('brand.css'));
 }
 assert.ok(src('index.html').indexOf('flat_finish.css')>src('index.html').indexOf('overview.css'));
});
test('matte panels have discreet depth rather than acrylic/embossed gloss',()=>{
 const css=src('flat_finish.css');
 assert.match(css,/--flat-panel-shadow:0 8px 24px/);
 assert.match(css,/--flat-control-shadow:0 2px 5px/);
 assert.match(css,/background:#D49A58!important/);
 assert.match(css,/border-radius:999px!important/);
 assert.match(css,/backdrop-filter:none!important/);
 assert.doesNotMatch(css,/linear-gradient\(|radial-gradient\(|drop-shadow\(|saturate\(|brightness\(/);
});
test('Satellite imagery is never filtered and functional monitor markup survives',()=>{
 const css=src('flat_finish.css'),monitor=src('monitor.html');
 assert.match(css,/#canvasViewport img,[\s\S]*?filter:none!important/);
 for(const id of ['canvasViewport','timelineScroll','changeLayer','regionInspector','compareRange'])
  assert.ok(monitor.includes('id="'+id+'"'),id);
});
test('all matte panels and controls keep visible focus and reduced-motion support',()=>{
 const css=src('flat_finish.css');
 assert.match(css,/body button:focus-visible/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/\.overview-area\.active/);
});
