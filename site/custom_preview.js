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
async function previewOne(item,area,GeoTIFF,proj4,signal){
 if(signal?.aborted)throw Error("Cancelled");
 const url=urlAsset(item,"visual");
 const tiff=await GeoTIFF.fromUrl(url,{cacheSize:10000000});
 const im=await tiff.getImage(0);
 let epsg=Number(item?.assets?.visual?.["proj:epsg"]||
                 item?.properties?.["proj:epsg"]||
                 im.getGeoKeys?.()?.ProjectedCSTypeGeoKey||
                 im.geoKeys?.ProjectedCSTypeGeoKey);
 if(!isUTM(epsg))throw Error("Unrecognized UTM CRS");
 const bbox=projectedBounds(area,epsg,proj4);
 const window=pixelWindow(im,bbox);
 if(im.getSamplesPerPixel()<3)throw Error("No 3-band true-color COG");
 const size=G.outputSize;
 // Read only a 2×2 km window; COG's internal overviews are used when supported.
 const vals=await tiff.readRasters({
     bbox,width:size,height:size,samples:[0,1,2],
     interleave:true,resampleMethod:"bilinear"
 });
 if(signal?.aborted)throw Error("Cancelled");
 if(vals.length!==size*size*3)throw Error("Unexpected raster samples");
 const bytes=new Uint8ClampedArray(size*size*4);
 const type=im.getSampleFormat?.()||1;
 const imtype=Array.isArray(type)?type[0]:type;
 const bps=im.getBitsPerSample();
 const bits=Array.isArray(bps)?bps[0]:bps;
 const byteRGB=bits===8&&imtype===1;
 if(!byteRGB)throw Error("Visual COG is not 8-bit RGB; cannot display faithfully");
 let visible=0;
 for(let i=0;i<size*size;i++){
   const j=i*3,k=i*4;
   const r=Number(vals[j]),g=Number(vals[j+1]),b=Number(vals[j+2]);
   bytes[k]=r;bytes[k+1]=g;bytes[k+2]=b;bytes[k+3]=255;
   if(r>0||g>0||b>0)visible++;
 }
 if(visible/size/size<.8)throw Error("Scene has too many missing pixels");
 let cloudFraction=null;
 const scl=urlAsset(item,"scl");
 if(scl){
   try{
     const sclTiff=await GeoTIFF.fromUrl(scl);
     const sclImage=await sclTiff.getImage(0);
     const sclProjection=Number(item?.assets?.scl?.["proj:epsg"]||
       item?.properties?.["proj:epsg"]||
       sclImage.getGeoKeys?.()?.ProjectedCSTypeGeoKey||
       sclImage.geoKeys?.ProjectedCSTypeGeoKey);
     const sclBounds=projectedBounds(area,sclProjection,proj4);
     pixelWindow(sclImage,sclBounds);
     const sample=await sclTiff.readRasters({
       bbox:sclBounds,width:100,height:100,samples:[0],interleave:true,
       resampleMethod:"nearest"
     });
     cloudFraction=localClear(sample);
   }catch(_){cloudFraction=null;}
 }
 if(cloudFraction!==null&&cloudFraction<G.minClear)
   throw Error("Locally cloudy ("+Math.round(100*(1-cloudFraction))+"% cloud or unusable)");
 const canvas=global.document.createElement("canvas");canvas.width=size;canvas.height=size;
 canvas.getContext("2d").putImageData(new ImageData(bytes,size,size),0,0);
 const image=canvas.toDataURL("image/png");
 return {id:item.id,date:itemDate(item),
     cloudFraction,globalCloud:Number(item.properties["eo:cloud_cover"]),
     image,epsg,sourceAsset:url};
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
     const result=await previewOne(item,area,global.GeoTIFF,global.proj4,signal);
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
  projectedBounds,localClear,chooseItems,pixelWindow,render,exactSelection,renderSelected};
if(typeof module==="object"&&module.exports)module.exports=core;
global.InfraCustomPreview=core;
})(typeof window!=="undefined"?window:globalThis);
