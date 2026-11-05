/* InfraTrack in-browser Sentinel-2 visual COG comparison for custom areas.
 * Source: STAC Earth Search, actual visual GeoTIFF pixels, SCL local cloud check.
 * Browser-only; no pretended ongoing background processing or ML change label.
 */
(function (global) {
"use strict";
const G={maxCandidates:14,minSeparationDays:5,minClear:0.60,outputSize:256};
function itemDate(item){
 const dt=item?.properties?.datetime;
 return typeof dt==="string"&&/^\d{4}-\d{2}-\d{2}/.test(dt)?dt.slice(0,10):null;
}
function urlAsset(item,key){
 const href=item?.assets?.[key]?.href;
 if(typeof href!=="string"||!href.startsWith("https://"))return null;
 // Only true-color visual COG or scene classification (no thumbnails).
 return href;
}
function isUTM(epsg){return Number.isInteger(epsg)&&(epsg>=32601&&epsg<=32660||epsg>=32701&&epsg<=32760)}
function UTMDefinition(epsg){
 if(!isUTM(epsg))throw Error("Scene projection not supported: EPSG:"+epsg);
 const zone=epsg%100;return "+proj=utm +zone="+zone+
   (epsg>=32700?" +south":"")+" +datum=WGS84 +units=m +no_defs +type=crs";
}
function geoBounds(area){
 const lat=Number(area.lat),lon=Number(area.lon),km=Number(area.size_km)||2;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<34||lat>72||lon< -25||lon>45||
    km<.2||km>4)throw Error("Invalid 2 km European study area");
 const dl=km/(2*111.32),dx=km/(2*111.32*Math.cos(lat*Math.PI/180));
 return [lon-dx,lat-dl,lon+dx,lat+dl];
}
function projectedBounds(area,epsg,proj4){
 if(!isUTM(epsg)||typeof proj4!=="function")throw Error("COG georeferencing unavailable");
 const code="EPSG:"+epsg;
 proj4.defs(code,UTMDefinition(epsg));
 const [w,s,e,n]=geoBounds(area);
 const corners=[[w,s],[e,s],[w,n],[e,n]].map(point=>proj4("EPSG:4326",code,point));
 const xs=corners.map(v=>v[0]),ys=corners.map(v=>v[1]);
 return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
// Every displayed pixel is indexed by one shared WGS84 lon/lat position.
// Source COG tiles may use different UTM projections or north-up axes.
// Reproject to that common grid before any visual residual registration.
function commonGrid(area,epsg,proj4,outputSize=G.outputSize,sourceSize=G.outputSize*2){
 if(!Number.isInteger(outputSize)||outputSize<2||outputSize>2048||
    !Number.isInteger(sourceSize)||sourceSize<outputSize||sourceSize>4096)
   throw Error("Invalid common geographic grid dimensions");
 const bbox=projectedBounds(area,epsg,proj4);
 const [west,south,east,north]=geoBounds(area),code="EPSG:"+epsg;
 const indices=new Int32Array(outputSize*outputSize).fill(-1);
 for(let y=0;y<outputSize;y++){
  const latitude=north-(y+.5)/outputSize*(north-south);
  for(let x=0;x<outputSize;x++){
   const longitude=west+(x+.5)/outputSize*(east-west);
   const projected=proj4("EPSG:4326",code,[longitude,latitude]);
   if(!Array.isArray(projected)||projected.length<2||
      !Number.isFinite(projected[0])||!Number.isFinite(projected[1]))
     throw Error("Common-grid coordinate reprojection failed");
   const px=Math.floor((projected[0]-bbox[0])/(bbox[2]-bbox[0])*sourceSize);
   const py=Math.floor((bbox[3]-projected[1])/(bbox[3]-bbox[1])*sourceSize);
   if(px>=0&&px<sourceSize&&py>=0&&py<sourceSize)
    indices[y*outputSize+x]=py*sourceSize+px;
  }
 }
 return {bbox,indices,sourceSize,outputSize,epsg,geoBounds:[west,south,east,north]};
}
function regridSamples(source,channels,grid){
 if(!Number.isInteger(channels)||channels<1||channels>4||
    !source||source.length!==grid.sourceSize*grid.sourceSize*channels)
  throw Error("Invalid source raster for geographic regridding");
 // Preserve the original COG numeric type (e.g. uint16 reflectance).
 const output=new source.constructor(grid.outputSize*grid.outputSize*channels);
 for(let p=0;p<grid.indices.length;p++){
  const q=grid.indices[p];
  if(q<0)continue; // outside valid source coordinates => missing pixels
  for(let c=0;c<channels;c++)output[p*channels+c]=source[q*channels+c];
 }
 return output;
}
function localClear(data){
 const total=data.length;if(!total)return 0;
 let usable=0;
 for(const p of data)if(p===4||p===5||p===6)usable++;
 return usable/total;
}
function chooseItems(features,days,ref=new Date()){
 const after=ref.getTime(),start=after-days*86400000;
 const seen=new Set();
 return (Array.isArray(features)?features:[])
   .filter(x=>itemDate(x)&&
         new Date(x.properties.datetime).getTime()>=start&&
         new Date(x.properties.datetime).getTime()<=after&&
         urlAsset(x,"visual")&&
         Number.isFinite(Number(x.properties["eo:cloud_cover"]))&&
         Number(x.properties["eo:cloud_cover"])<=75)
   .sort((a,b)=>b.properties.datetime.localeCompare(a.properties.datetime))
   .filter(x=>{const date=itemDate(x);if(seen.has(date))return false;seen.add(date);return true})
   .slice(0,G.maxCandidates);
}
function pixelWindow(image,bbox) {
 const origin=image.getOrigin(),res=image.getResolution();
 if(!origin||!res||Math.abs(res[0])<1e-8||Math.abs(res[1])<1e-8)
   throw Error("Missing COG grid origin or resolution");
 const pts=[[bbox[0],bbox[1]],[bbox[2],bbox[3]]]
   .map(([x,y])=>[(x-origin[0])/res[0],(y-origin[1])/res[1]]);
 const raw=[Math.floor(Math.min(pts[0][0],pts[1][0])),
            Math.floor(Math.min(pts[0][1],pts[1][1])),
            Math.ceil(Math.max(pts[0][0],pts[1][0])),
            Math.ceil(Math.max(pts[0][1],pts[1][1]))];
 if(raw[0]<0||raw[1]<0||raw[2]>image.getWidth()||raw[3]>image.getHeight())
   throw Error("Scene does not fully cover the chosen square");
 if(raw[2]-raw[0]<8||raw[3]-raw[1]<8)
   throw Error("Scene pixel coverage is insufficient");
 return raw;
}
async function previewOne(item,area,GeoTIFF,proj4,signal,options={}){
 if(signal?.aborted)throw Error("Cancelled");
 const url=urlAsset(item,"visual");
 if(!url)throw Error("No original visual GeoTIFF for this observation");
 const tiff=await GeoTIFF.fromUrl(url,{cacheSize:2000000});
 const im=await tiff.getImage(0);
 const epsg=Number(item?.assets?.visual?.["proj:epsg"]||
                 item?.properties?.["proj:epsg"]||
                 im.getGeoKeys?.()?.ProjectedCSTypeGeoKey||
                 im.geoKeys?.ProjectedCSTypeGeoKey);
 if(!isUTM(epsg))throw Error("Unrecognized Sentinel UTM image projection");
 const visualGrid=commonGrid(area,epsg,proj4);
 const bbox=visualGrid.bbox;
 pixelWindow(im,bbox);
 if(im.getSamplesPerPixel()<3)throw Error("Original image does not contain three RGB bands");
 let cloudFraction=null,localCheckError=null,cloudMask=null,sclClasses=null;
 const scl=urlAsset(item,"scl");
 if(scl){
   try{
     const sclTiff=await GeoTIFF.fromUrl(scl);
     const sclImage=await sclTiff.getImage(0);
     const sclProjection=Number(item?.assets?.scl?.["proj:epsg"]||
       item?.properties?.["proj:epsg"]||
       sclImage.getGeoKeys?.()?.ProjectedCSTypeGeoKey||
       sclImage.geoKeys?.ProjectedCSTypeGeoKey);
     const sclGrid=sclProjection===epsg?visualGrid:commonGrid(area,sclProjection,proj4);
     pixelWindow(sclImage,sclGrid.bbox);
     const sourceSCL=await sclTiff.readRasters({
       bbox:sclGrid.bbox,width:sclGrid.sourceSize,height:sclGrid.sourceSize,
       samples:[0],interleave:true,resampleMethod:"nearest"
     });
     const sample=regridSamples(sourceSCL,1,sclGrid);
     sclClasses=sample;
     cloudFraction=localClear(sample);
     cloudMask=new Uint8Array(sample.length);
     for(let i=0;i<sample.length;i++){
       // Sentinel SCL: vegetation (4), bare surfaces (5), water (6).
       // Clouds/shadows/snow/unclassified are not trusted for change detection.
       cloudMask[i]=(sample[i]===4||sample[i]===5||sample[i]===6)?1:0;
     }
   }catch(err){localCheckError=String(err?.message||err);}
 }else localCheckError="SCL asset missing";
 if(signal?.aborted)throw Error("Cancelled");
 const minClear=Number.isFinite(options.minClear)?options.minClear:G.minClear;
 if(options.requireLocalScreening&&cloudFraction===null)
   throw Error("Could not verify local cloud cover: "+(localCheckError||"unknown"));
 if(cloudFraction!==null&&cloudFraction<minClear&&!options.allowCloudy)
   throw Error("Locally cloudy or invalid ("+Math.round(100*(1-cloudFraction))+
       "% unusable pixels); no scene substitution");
 const size=G.outputSize;
 const sourceRGB=await tiff.readRasters({
     bbox,width:visualGrid.sourceSize,height:visualGrid.sourceSize,samples:[0,1,2],
     interleave:true,resampleMethod:"nearest"
 });
 const vals=regridSamples(sourceRGB,3,visualGrid);
 if(signal?.aborted)throw Error("Cancelled");
 if(vals.length!==size*size*3)throw Error("Unexpected raster size from source");
 const bytes=new Uint8ClampedArray(size*size*4);
 const typ=im.getSampleFormat?.()||1;
 const imtype=Array.isArray(typ)?typ[0]:typ;
 const bps=im.getBitsPerSample();
 const bits=Array.isArray(bps)?bps[0]:bps;
 if(bits!==8||imtype!==1)throw Error("Original visual image is not 8-bit RGB");
 let visible=0;
 for(let i=0;i<size*size;i++){
   const j=i*3,k=i*4;
   const r=Number(vals[j]),g=Number(vals[j+1]),b=Number(vals[j+2]);
   bytes[k]=r;bytes[k+1]=g;bytes[k+2]=b;bytes[k+3]=255;
   if(r>0||g>0||b>0)visible++;
 }
 if(visible/size/size<.8)throw Error("Original image has too many missing pixels");
 const canvas=global.document.createElement("canvas");canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext("2d");
 if(!ctx)throw Error("Canvas 2D unavailable in this browser");
 const pixels=ctx.createImageData(size,size);
 pixels.data.set(bytes);ctx.putImageData(pixels,0,0);
 return {
   id:item.id,date:itemDate(item),cloudFraction,
   globalCloud:Number(item.properties["eo:cloud_cover"]),
   image:canvas.toDataURL("image/png"),
   rgba:bytes,width:size,height:size,cloudMask,sclClasses,
   epsg,sourceAsset:url,
   gridMode:"WGS84 common-grid",geographicBounds:visualGrid.geoBounds,
   localCheckError,
   warning:cloudFraction===null?
     "Local cloud screening unavailable — scene cloud percentage is not local.":
     cloudFraction<minClear?
       "Cloudy at selected location ("+Math.round(100*(1-cloudFraction))+"% unsuitable).":
       null
 };
}
async function render(area,items,options={}){
 if(!global.GeoTIFF||!global.proj4)throw Error(
     "Satellite image viewer did not load. Try reloading the page.");
 const ref=options.now||new Date();
 const candidates=chooseItems(items,options.days||90,ref);
 if(candidates.length<2)
   throw Error("Fewer than two recent Sentinel-2 visual scenes found. Try 180 days.");
 const seen=[];const failures=[];const token=options.signal;
 for(const item of candidates){
   if(token?.aborted)throw Error("Cancelled");
   if(seen.length){
     const diff=Math.abs(Date.parse(itemDate(seen[0]))-Date.parse(itemDate(item)));
     if(diff<G.minSeparationDays*86400000)continue;
   }
   options.onProgress?.("Reading real satellite pixels for "+
     itemDate(item)+" ("+(seen.length+1)+"/2)…");
   try{
     const result=await previewOne(item,area,global.GeoTIFF,global.proj4,token);
     seen.push({...result,raw:item});
     if(seen.length===2)break;
   }catch(err){
     failures.push(itemDate(item)+": "+err.message);
     if(failures.length>=G.maxCandidates)break;
   }
 }
 if(seen.length<2){
   throw Error("Cannot render two locally usable real scenes. "+
     "Possible causes: cloud cover, unavailable GeoTIFFs, browser CORS or missing coverage. "+
     failures.slice(-2).join(" | "));
 }
 seen.sort((a,b)=>a.date.localeCompare(b.date));
 return {before:seen[0],after:seen[1],
     scenesConsidered:candidates.length,locallyScreened:seen.every(x=>x.cloudFraction!==null),
     note:seen.some(x=>x.cloudFraction===null)?
       "Locally cloud-check could not be completed for both dates; interpret cautiously.":
       "Both image crops passed local Sentinel scene-classification screening."};
}
// Read genuine reflectance rasters only when the user requests NDVI.
// STAC raster:bands scale/offset are scene-specific; do not use the RGB JPEG values.
async function readNDVI(item,area,options={}){
 if(!global.GeoTIFF||!global.proj4)throw Error("Spectral viewer dependencies unavailable");
 const signal=options.signal,GeoTIFF=global.GeoTIFF,proj4=global.proj4;
 const keys=["red","nir"],bands=[];
 for(const key of keys){
  if(signal?.aborted)throw Error("Cancelled");
  const asset=item?.assets?.[key],url=urlAsset(item,key);
  if(!url)throw Error("Sentinel-2 "+key+" reflectance asset unavailable");
  const meta=asset?.["raster:bands"]?.[0];
  const scale=Number(meta?.scale),offset=Number(meta?.offset??0);
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(offset))
   throw Error("Unverified scale/offset metadata for "+key+" band");
  const tiff=await GeoTIFF.fromUrl(url);
  const image=await tiff.getImage(0);
  const epsg=Number(asset?.["proj:epsg"]||item?.properties?.["proj:epsg"]||
   image.getGeoKeys?.()?.ProjectedCSTypeGeoKey||image.geoKeys?.ProjectedCSTypeGeoKey);
  if(!isUTM(epsg))throw Error("Spectral band has unsupported projection");
  const grid=commonGrid(area,epsg,proj4);
  pixelWindow(image,grid.bbox);
  const raw=await tiff.readRasters({bbox:grid.bbox,
   width:grid.sourceSize,height:grid.sourceSize,
   samples:[0],interleave:true,resampleMethod:"nearest"});
  if(signal?.aborted)throw Error("Cancelled");
  const mapped=regridSamples(raw,1,grid);
  bands.push({key,values:mapped,scale,offset});
 }
 const n=G.outputSize*G.outputSize;
 const ndvi=new Float32Array(n).fill(NaN);
 let valid=0;
 for(let p=0;p<n;p++){
  const rr=bands[0].values[p],nn=bands[1].values[p];
  if(!(rr>0&&nn>0))continue; // source no-data is zero
  const red=rr*bands[0].scale+bands[0].offset;
  const nir=nn*bands[1].scale+bands[1].offset;
  if(!(red>0&&nir>0))continue;
  const value=(nir-red)/(nir+red);
  if(!Number.isFinite(value))continue;
  ndvi[p]=Math.max(-1,Math.min(1,value));valid++;
 }
 if(valid<n*.2)throw Error("Insufficient valid reflectance pixels for NDVI");
 return {ndvi,valid,width:G.outputSize,height:G.outputSize,
  source:"Sentinel-2 B04/B08; STAC reflectance scale/offset",
  date:itemDate(item),sceneId:item.id};
}
// Explicit scene selection does not substitute another date or scene ID.
// The exact STAC item behind each selected acquisition card is rendered.
function exactSelection(items) {
 if(!Array.isArray(items)||items.length<1||items.length>2)
   throw Error("Choose one or two acquisition dates");
 const ids=new Set();
 for(const item of items){
   if(!item||typeof item.id!=="string"||!itemDate(item)||
      !urlAsset(item,"visual")||ids.has(item.id))
     throw Error("Selected observation has no unique real Sentinel visual asset");
   ids.add(item.id);
 }
 return items.slice().sort((a,b)=>a.properties.datetime.localeCompare(b.properties.datetime));
}
async function renderSelected(area,items,options={}) {
 if(!global.GeoTIFF||!global.proj4)
   throw Error("Satellite viewer scripts unavailable. Please reload the page.");
 const selected=exactSelection(items);
 const rendered=[];
 const signal=options.signal;
 const cache=options.cache instanceof Map?options.cache:null;
 for(const item of selected){
   if(signal?.aborted)throw Error("Cancelled");
   options.onProgress?.("Loading the exact Sentinel-2 observation from "+itemDate(item)+"…");
   // Cache crops by area and exact scene ID, never by date alone.
   const cacheKey=String(area.id||"unnamed")+":"+item.id;
   if(cache?.has(cacheKey)){
     rendered.push(cache.get(cacheKey));
     continue;
   }
   // Any individual scene failure is returned to the user, not replaced by
   // another scene with a different timestamp.
   try {
     const result=await previewOne(item,area,global.GeoTIFF,global.proj4,signal,options);
     if(signal?.aborted)throw Error("Cancelled");
     rendered.push(result);
     if(cache){
       cache.set(cacheKey,result);
       while(cache.size>8)cache.delete(cache.keys().next().value);
     }
   } catch(err) {
     if(signal?.aborted)throw Error("Cancelled");
     throw Error("Cannot display the selected "+itemDate(item)+" scene: "+err.message);
   }
 }
 return {count:rendered.length,dates:rendered.map(x=>x.date),
   scenes:rendered,
   locallyScreened:rendered.every(x=>x.cloudFraction!==null),
   note:rendered.every(x=>x.cloudFraction!==null)?
     "The selected observation(s) passed local SCL clear-pixel screening. Card cloud percentages are whole-scene values.":
     "At least one local cloud mask was unavailable; the selected scene(s) may include clouds.",
   selectionIsExact:true};
}

const core={G,itemDate,urlAsset,isUTM,UTMDefinition,geoBounds,
  projectedBounds,commonGrid,regridSamples,readNDVI,localClear,chooseItems,pixelWindow,
  render,exactSelection,renderSelected};
if(typeof module==="object"&&module.exports)module.exports=core;
global.InfraCustomPreview=core;
})(typeof window!=="undefined"?window:globalThis);
