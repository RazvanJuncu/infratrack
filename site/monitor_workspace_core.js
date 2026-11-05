/*
 * InfraTrack Monitor Workspace — testable state helpers.
 * No generated satellite data or unverified training labels.
 */
(function (root) {
"use strict";
const KEY="infratrack:watchlist:v1";
const MIN_LAT=34,MAX_LAT=72,MIN_LON=-25,MAX_LON=45;
function isAllowed(lat,lon) {
 return Number.isFinite(lat)&&Number.isFinite(lon)&&
   lat>=MIN_LAT&&lat<=MAX_LAT&&lon>=MIN_LON&&lon<=MAX_LON;
}
function bounds(area){
 const km=Number(area.size_km)||2,lat=Number(area.lat),lon=Number(area.lon);
 if(!isAllowed(lat,lon)||km<.2||km>4)throw Error("Area outside current European study bounds");
 const dy=km/(2*111.32),dx=km/(2*111.32*Math.cos(lat*Math.PI/180));
 return [lon-dx,lat-dy,lon+dx,lat+dy];
}
function validSaved(x){
 return x&&/^custom-\d+(?:-\d+)?$/.test(x.id||"")&&
  typeof x.name==="string"&&x.name.trim().length>=2&&x.name.length<=60&&
  isAllowed(Number(x.lat),Number(x.lon))&&x.size_km===2&&
  ["construction","farmland","forest","urban","other"].includes(x.type);
}
function readSaved(storage){
 try{
   const list=JSON.parse(storage?.getItem(KEY)||"[]");
   if(!Array.isArray(list))return [];
   const ids=new Set();
   return list.filter(x=>{
     if(!validSaved(x)||ids.has(x.id))return false;
     ids.add(x.id);return true;
   }).slice(0,50);
 }catch{return [];}
}
function sceneDate(item) {
 const dt=item?.properties?.datetime;
 return typeof dt==="string"&&/^\d{4}-\d{2}-\d{2}/.test(dt)?dt.slice(0,10):null;
}
// Display dates are UTC to preserve the exact satellite acquisition day.
const SHORT_DATE=new Intl.DateTimeFormat("en-GB",{
 day:"numeric",month:"short",year:"numeric",timeZone:"UTC"
});
const MONTH_DATE=new Intl.DateTimeFormat("en-GB",{
 month:"long",timeZone:"UTC"
});
function parsedDay(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const d=new Date(value+"T00:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value?d:null;
}
function humanDate(iso){
 const d=parsedDay(iso);return d?SHORT_DATE.format(d):null;
}
function timelineGroup(iso){
 const d=parsedDay(iso);
 return d?{year:iso.slice(0,4),month:iso.slice(0,7),monthName:MONTH_DATE.format(d)}:null;
}
function sceneCloud(item) {
 const raw=item?.properties?.["eo:cloud_cover"];
 const n=raw===undefined||raw===null?NaN:Number(raw);
 return Number.isFinite(n)&&n>=0&&n<=100?n:null;
}
function containsBbox(rect,areaBox){
 return Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&
     rect[0]<=areaBox[0]&&rect[1]<=areaBox[1]&&
     rect[2]>=areaBox[2]&&rect[3]>=areaBox[3];
}
// Distinct chronological dates. Prefer a scene whose tile contains the entire area
// over one at the edge of a tile. Do not replace an explicitly chosen scene later.
function catalogScenes(features,area,max=100){
 const list=Array.isArray(features)?features:[];
 const roi=bounds(area);
 const byDay=new Map();
 for(const item of list){
   if(!sceneDate(item)||typeof item?.id!=="string"||!item.id)continue;
   const day=sceneDate(item);
   const complete=containsBbox(item.bbox,roi)?1:0;
   const hasRGB=typeof item.assets?.visual?.href==="string"&&
                   item.assets.visual.href.startsWith("https://")?1:0;
   const cloud=sceneCloud(item);
   const rank=complete*1000+hasRGB*100+(cloud===null?0:(100-cloud));
   if(!byDay.has(day)||rank>byDay.get(day).rank)
     byDay.set(day,{rank,item});
 }
 return [...byDay.values()].map(x=>x.item)
   .sort((a,b)=>b.properties.datetime.localeCompare(a.properties.datetime))
   .slice(0,max);
}
function ordered(items) {
 return items.slice().sort((a,b)=>sceneDate(a).localeCompare(sceneDate(b)));
}
// Two named Canvas placements, ordered chronologically only for display.
function dropInto(slots,slot,sceneId){
 if(!["before","after"].includes(slot)||typeof sceneId!=="string"||!sceneId) return {...slots};
 const result={before:slots.before||null,after:slots.after||null};
 if(result.before===sceneId||result.after===sceneId){
   if(slot==="before"&&result.after===sceneId){
     result.after=result.before;result.before=sceneId;
   }else if(slot==="after"&&result.before===sceneId){
     result.before=result.after;result.after=sceneId;
   }
 }else result[slot]=sceneId;
 return result;
}
function addByClick(slots,sceneId) {
 if(slots.before===sceneId||slots.after===sceneId)return {...slots};
 if(!slots.before)return {...slots,before:sceneId};
 if(!slots.after)return {...slots,after:sceneId};
 // Replace most recently placed image for predictable tap behavior.
 return {...slots,after:sceneId};
}
function removeFrom(slots,slot){
 if(!["before","after"].includes(slot))return {...slots};
 return {...slots,[slot]:null};
}
function pairFrom(slots,lookup){
 const a=slots.before?lookup.get(slots.before):null;
 const b=slots.after?lookup.get(slots.after):null;
 return ordered([a,b].filter(Boolean));
}
function uniqueIds(items) {return new Set(items.map(x=>x.id)).size===items.length;}
function sliderClip(percent) {
 const n=Math.max(0,Math.min(100,Number(percent)||0));
 return "inset(0 "+(100-n)+"% 0 0)";
}
function cloudAlert(items,selected) {
 if(!selected.length)return "";
 const newest=items[0];
 if(!newest||!sceneDate(newest))return "";
 const usedNewest=selected.reduce((t,x)=>sceneDate(x)>t?sceneDate(x):t,"");
 if(sceneDate(newest)<=usedNewest)return "";
 const pct=sceneCloud(newest);
 return "Latest acquisition "+sceneDate(newest)+
   (pct===null?" has unknown whole-scene cloud cover":
   " has "+Math.round(pct)+"% whole-scene cloud cover")+
   "; showing older usable observations. Cloud cover for the exact square may differ.";
}
function payload(id,areaId){return JSON.stringify({type:"infratrack-scene",id,areaId});}
function parsePayload(text,areaId){
 try{
   const v=JSON.parse(text);
   if(v?.type==="infratrack-scene"&&v.areaId===areaId&&
      typeof v.id==="string"&&v.id.length<250)return v.id;
 }catch{}
 return null;
}
// Image crops are also cached as self-contained PNGs. Older or differently
// constructed cached previews may have an image but no Uint8ClampedArray.
// Convert supported byte views and, if necessary, decode the exact displayed
// PNG instead of letting a valid visual pair crash the highlight control.
async function alignedRGBA(scene,decodeImage){
 const width=Number(scene?.width),height=Number(scene?.height);
 if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<1||height<1||width>2048||height>2048)
   throw Error("Satellite crop dimensions are unavailable");
 const expected=width*height*4;
 const data=scene?.rgba;
 if(data&&typeof data.length==="number"&&data.length===expected&&
    (ArrayBuffer.isView(data)||Array.isArray(data)))
   return new Uint8ClampedArray(data);
 if(typeof decodeImage!=="function"||typeof scene?.image!=="string"||
    !scene.image.startsWith("data:image/png"))
   throw Error("Original scene has no usable RGBA pixels or image backup");
 const decoded=await decodeImage(scene.image,width,height);
 if(!decoded||decoded.length!==expected||!ArrayBuffer.isView(decoded))
   throw Error("Decoded preview did not match the study-area dimensions");
 return new Uint8ClampedArray(decoded);
}
// RGB differences: an *untrained* visual signal, not calibrated change detection.
// Cloud/season/atmosphere may produce false positives, especially without SCL.
function rgbDifference(before,after,threshold=48,beforeMask=null,afterMask=null){
 if(!(before instanceof Uint8ClampedArray)||!(after instanceof Uint8ClampedArray)||
    before.length!==after.length||before.length%4)
   throw Error("Aligned 8-bit RGBA images are required");
 const overlay=new Uint8ClampedArray(before.length);
 const pixels=before.length/4;
 if(beforeMask&&beforeMask.length!==pixels||afterMask&&afterMask.length!==pixels)
   throw Error("Cloud masks must match the aligned satellite grid");
 let changed=0,valid=0;
 for(let p=0;p<before.length;p+=4){
   const pixel=p/4;
   if(beforeMask&&beforeMask[pixel]!==1||afterMask&&afterMask[pixel]!==1)continue;
   const a=before[p],b=before[p+1],c=before[p+2],
      d=after[p],e=after[p+1],f=after[p+2];
   if(before[p+3]===0||after[p+3]===0||
      (a===0&&b===0&&c===0)||(d===0&&e===0&&f===0))continue;
   valid++;
   const delta=(Math.abs(a-d)+Math.abs(b-e)+Math.abs(c-f))/3;
   if(delta>=threshold){
     changed++;
     overlay[p]=255;overlay[p+1]=97;overlay[p+2]=51;
     overlay[p+3]=Math.min(185,Math.round(65+(delta-threshold)*1.5));
   }
 }
 return {rgba:overlay,changed,valid,
    percent:valid?Math.round(changed/valid*1000)/10:null,
    threshold,model:"Untrained RGB visual difference, not AI"};
}
const api={KEY,isAllowed,bounds,validSaved,readSaved,sceneDate,sceneCloud,humanDate,timelineGroup,
  containsBbox,catalogScenes,ordered,dropInto,addByClick,removeFrom,
  pairFrom,uniqueIds,sliderClip,cloudAlert,payload,parsePayload,rgbDifference,alignedRGBA};
if(typeof module==="object"&&module.exports)module.exports=api;
root.InfraWorkspaceCore=api;
})(typeof window!=="undefined"?window:globalThis);
