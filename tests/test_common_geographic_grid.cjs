const test=require('node:test');
const assert=require('node:assert/strict');
const preview=require('../site/custom_preview.js');

// Two mock UTM-style projections with opposing 4.3-degree grid convergence.
// A single physical feature should land at the same WGS84 output pixel.
const center={lon:26,lat:45};
function proj4(from,to,point){
 const angle={ 'EPSG:32634':-0.075,'EPSG:32635':0.075 };
 const theta=angle[to]??angle[from];
 if(theta===undefined)throw Error('Unexpected test CRS');
 const co=Math.cos(theta),si=Math.sin(theta);
 const sx=111000*Math.cos(Math.PI/4),sy=111000;
 if(from==='EPSG:4326'){
  const x=(point[0]-center.lon)*sx,y=(point[1]-center.lat)*sy;
  return [400000+x*co-y*si,5000000+x*si+y*co];
 }
 const x=point[0]-400000,y=point[1]-5000000;
 return [center.lon+(x*co+y*si)/sx,center.lat+(-x*si+y*co)/sy];
}
proj4.defs=()=>{};
const area={lat:45,lon:26,size_km:2};
function createSource(grid,epsg,channels=3){
 const {sourceSize,bbox}=grid;
 const arr=new Uint8Array(sourceSize*sourceSize*channels);
 for(let y=0;y<sourceSize;y++)for(let x=0;x<sourceSize;x++){
  const projected=[
   bbox[0]+(x+.5)/sourceSize*(bbox[2]-bbox[0]),
   bbox[3]-(y+.5)/sourceSize*(bbox[3]-bbox[1])
  ];
  const [lon,lat]=proj4('EPSG:'+epsg,'EPSG:4326',projected);
  const east=(lon-area.lon)*111000*Math.cos(Math.PI/4);
  const north=(lat-area.lat)*111000;
  const road=Math.abs(east+north*.18-160)<35||Math.abs(north-east*.23+200)<30;
  const forest=(east+130)**2+(north-270)**2<185**2;
  const v=road?210:forest?40:90+20*Math.sin(east/140)+10*Math.cos(north/200);
  const p=(y*sourceSize+x)*channels;
  if(channels===1){arr[p]=north>220?8:4;continue}
  arr[p]=Math.max(0,Math.min(255,v));
  arr[p+1]=Math.max(0,Math.min(255,v+(forest?28:4)));
  arr[p+2]=Math.max(0,Math.min(255,v-8));
 }
 return arr;
}
test('two differently oriented source CRSs produce matching geographic image pixels',()=>{
 const a=preview.commonGrid(area,32634,proj4,64,256);
 const b=preview.commonGrid(area,32635,proj4,64,256);
 assert.deepEqual(a.geoBounds,b.geoBounds);
 const imgA=preview.regridSamples(createSource(a,32634),3,a);
 const imgB=preview.regridSamples(createSource(b,32635),3,b);
 let abs=0,large=0,valid=0;
 for(let i=0;i<imgA.length;i+=3){
  if(imgA[i]===0||imgB[i]===0)continue;
  valid++;const d=Math.abs(imgA[i]-imgB[i]);
  abs+=d;if(d>40)large++;
 }
 assert.ok(valid>4000,'both reprojected scenes cover the same window');
 assert.ok(abs/valid<12,'geographically aligned pixels should be very similar');
 assert.ok(large/valid<.025,'road edges should not move into unrelated pixels');
});
test('cloud classification is sampled onto the same geographic grid as RGB',()=>{
 const a=preview.commonGrid(area,32634,proj4,64,256);
 const b=preview.commonGrid(area,32635,proj4,64,256);
 const sclA=preview.regridSamples(createSource(a,32634,1),1,a);
 const sclB=preview.regridSamples(createSource(b,32635,1),1,b);
 let equal=0;
 for(let p=0;p<sclA.length;p++)if(sclA[p]===sclB[p])equal++;
 assert.ok(equal/sclA.length>.98);
});
test('unavailable raster cells remain no-data, malformed source arrays fail',()=>{
 const grid=preview.commonGrid(area,32635,proj4,8,32);
 assert.throws(()=>preview.regridSamples(new Uint8Array(6),3,grid),/Invalid source raster/);
 assert.equal(preview.regridSamples(new Uint8Array(32*32).fill(4),1,grid).length,64);
});
test('Monitor requires common-grid previews before permitting residual overlay',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const script=fs.readFileSync(path.resolve(__dirname,'../site/monitor_workspace.js'),'utf8');
 const previewScript=fs.readFileSync(path.resolve(__dirname,'../site/custom_preview.js'),'utf8');
 assert.match(previewScript,/commonGrid\(area,epsg,proj4\)/);
 assert.match(previewScript,/regridSamples\(sourceRGB,3,visualGrid\)/);
 assert.match(previewScript,/regridSamples\(sourceSCL,1,sclGrid\)/);
 assert.match(script,/registrationV2\.estimateRegistration\(/);
 assert.match(script,/function sameGeographicGrid\(/);
 assert.match(script,/function showGeographicPair\(/);
 assert.match(script,/showGeographicPair\(first,second,reason\)/);
 assert.match(script,/\$\("highlightBtn"\)\.disabled=true/);

});
