/* InfraTrack Carbon / Sand branding must preserve functional page semantics. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const site=p=>fs.readFileSync(path.join(__dirname,'..','site',p),'utf8');
const routes=['index.html','monitor.html','training.html','technical.html'];

test('all active experiences share the same identity system without renaming unapproved production brand',()=>{
 const css=site('brand.css');
 for(const page of routes){
   const html=site(page);
   assert.match(html,/<link rel="stylesheet" href="brand\.css(?:\?v=[\w-]+)?">/);
   assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="mark\.svg">/);
   assert.match(html,/<img src="mark\.svg" class="brand-mark"/);
   assert.match(html,/Infra<span>Track<\/span>/);
   assert.match(html,/<title>InfraTrack/);
 }
 for(const key of ['--bg:#15191C','--panel:#24292D','--border:#383E41','--text:#E8E9E5','--accent:#D49A58','--brand-coral:#D75C56']){
   assert.ok(css.includes(key),key);
 }
 assert.match(css,/Geist/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/border-radius:999px/); // small controls are pills
 assert.match(css,/border-radius:0!important/); // large panes are square
 assert.match(css,/mask:var\(--ui-icon\)/); // monochrome interface icons
});

test('brand mark is source-controlled vector with no external image dependency',()=>{
 const svg=site('mark.svg');
 assert.match(svg,/<svg /);
 assert.match(svg,/viewBox="0 0 48 48"/);
 assert.match(svg,/<\/svg>/);
 assert.doesNotMatch(svg,/<image\s|<script\b|(?:href|xlink:href)=["']https?:\/\//i);
});

test('Brand Lab previews naming concepts but does not modify production names or localStorage',()=>{
 const html=site('brand-lab.html');
 for(const name of ['wherewhile','terrafter','plotshift','infratrack']){
   assert.ok(html.includes('data-name="'+name+'"'));
 }
 assert.match(html,/not a product rename/i);
 assert.match(html,/trademark/i);
 assert.doesNotMatch(html,/localStorage|sessionStorage/);
 assert.match(html,/document\.getElementById\('previewWord'\)/);
 assert.match(html,/aria-pressed/);
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match&&match[1],'Brand Lab inline script missing');
 assert.doesNotThrow(()=>new Function(match[1]));
});

test('active application controls and source-script references are unchanged',()=>{
 const monitor=site('monitor.html');
 for(const id of ['canvasViewport','canvasOld','canvasNew','timelineScroll',
    'compareRange','highlightBtn','latestButton','slotBefore','slotAfter']){
   assert.ok(monitor.includes('id="'+id+'"'),id);
 }
 for(const file of ['custom_preview.js','monitor_workspace_core.js',
      'image_registration.js','monitor_workspace.js']){
   assert.ok(monitor.includes('src="'+file+'"'),file);
 }
 const training=site('training.html');
 assert.match(training,/src="training_recent.js"/);
 const technical=site('technical.html');
 assert.match(technical,/src="technical_app.js"/);
});

test('brand palette retains accessible base foreground-to-background contrast',()=>{
 function relative(hex){
   const rgb=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255)
     .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
   return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
 }
 const css=site('brand.css');
 const token=name=>{
   const match=css.match(new RegExp('(?:^|\\s)'+name+':#([0-9A-Fa-f]{6})(?:;|\\s)'));
   assert.ok(match,'missing token '+name);
   return relative(match[1]);
 };
 const fg=token('--text'),bg=token('--bg'),surface=token('--panel'),muted=token('--muted'),sand=token('--brand-sand');
 const ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 assert.ok(ratio(fg,bg)>=7);
 assert.ok(ratio(muted,surface)>=4.5);
 assert.ok(ratio(sand,bg)>=4.5);
});
