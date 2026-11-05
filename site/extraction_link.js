/* InfraTrack / area extraction geometry — decorative, not geospatial evidence.
   Draws a live optical connection from the selected map footprint to the
   actual Sentinel crop container. Does not transform the satellite pixels. */
(function(root){
"use strict";
function finiteBox(b){
 return !!b&&["left","right","top","bottom"].every(k=>Number.isFinite(b[k]))&&
  b.right>b.left&&b.bottom>b.top;
}
function trim(v){return String(Math.round(v*10)/10)}
function geometry(source,target,viewport){
 if(!finiteBox(source)||!finiteBox(target)||
  !viewport||!(viewport.width>0&&viewport.height>0))return null;
 const width=viewport.width,height=viewport.height;
 // Wait until map zoom makes the selected study square legible.
 if(source.right-source.left<13||source.bottom-source.top<13)return null;
 // Do not draw when a marker is off-screen or hidden behind the preview.
 if(source.right<0||source.left>width||source.bottom<0||source.top>height)return null;
 const rightGap=target.left-source.right,leftGap=source.left-target.right;
 const forward=rightGap>26?true:leftGap>26?false:null;
 if(forward===null)return null;
 const startX=forward?source.right:source.left;
 const endX=forward?target.left:target.right;
 if(startX<0||startX>width||endX<0||endX>width)return null;
 const topY=source.top,bottomY=source.bottom;
 const previewTop=target.top,previewBottom=target.bottom;
 if(topY<0||bottomY>height||previewTop<0||previewBottom>height)return null;
 const between=Math.abs(endX-startX);
 if(between<28)return null;
 const beam=`M ${trim(startX)} ${trim(topY)} L ${trim(endX)} ${trim(previewTop)} L ${trim(endX)} ${trim(previewBottom)} L ${trim(startX)} ${trim(bottomY)} Z`;
 return {
  beam,
  top:`M ${trim(startX)} ${trim(topY)} L ${trim(endX)} ${trim(previewTop)}`,
  bottom:`M ${trim(startX)} ${trim(bottomY)} L ${trim(endX)} ${trim(previewBottom)}`,
  source:`M ${trim(startX)} ${trim(topY)} L ${trim(startX)} ${trim(bottomY)}`,
  target:`M ${trim(endX)} ${trim(previewTop)} L ${trim(endX)} ${trim(previewBottom)}`,
  direction:forward?"right":"left",
  span:between
 };
}
function render(svg,shape,viewport){
 if(!svg)return;
 if(!shape){
  svg.classList.remove("is-visible");
  return;
 }
 svg.setAttribute("viewBox",`0 0 ${viewport.width} ${viewport.height}`);
 for(const key of ["beam","top","bottom","source","target"]){
  const element=svg.querySelector("#extraction"+key[0].toUpperCase()+key.slice(1));
  if(element)element.setAttribute("d",shape[key]);
 }
 svg.dataset.direction=shape.direction;
 svg.classList.add("is-visible");
}
function clear(svg){render(svg,null,null)}
const api={geometry,render,clear};
if(typeof module==="object"&&module.exports)module.exports=api;
root.InfraExtractionLink=api;
})(typeof window!=="undefined"?window:globalThis);
