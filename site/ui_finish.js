/*
 * InfraTrack / reversible Liquid Glass experiment.
 * Purely visual. Never touches scene selection, data sources or analysis.
 * The default is Glass; selecting Classic persists only in this browser.
 */
(function(root){
"use strict";
const KEY="infratrack:ui-finish:v1";
const ATTRIBUTE="data-ui-finish";
function readFinish(storage){
 try{return storage?.getItem(KEY)==="classic"?"classic":"glass"}
 catch{return "glass"}
}
function setFinish(value,storage,element){
 const next=value==="classic"?"classic":"glass";
 (element||document.documentElement).setAttribute(ATTRIBUTE,next);
 try{storage?.setItem(KEY,next)}catch{}
 return next;
}
function safeStorage(){
 try{return root.localStorage}catch{return null}
}
function labelFor(value){
 return value==="glass"?"Glass":"Classic";
}
function insertToggle(){
 const nav=document.querySelector("header nav")||document.querySelector("body nav");
 if(!nav||document.getElementById("finishToggle"))return;
 const button=document.createElement("button");
 button.type="button";
 button.id="finishToggle";
 button.className="ui-finish-switch";
 const inner=document.createElement("span");
 inner.className="ui-finish-symbol";
 inner.setAttribute("aria-hidden","true");
 inner.textContent="✦";
 const label=document.createElement("span");
 label.className="ui-finish-label";
 button.append(inner,label);
 function render(){
  const current=document.documentElement.getAttribute(ATTRIBUTE)==="classic"?"classic":"glass";
  label.textContent=labelFor(current);
  button.setAttribute("aria-pressed",String(current==="glass"));
  button.setAttribute("aria-label",current==="glass"?
   "Liquid Glass on. Switch to classic Carbon Sand finish":
   "Classic Carbon Sand on. Switch to Liquid Glass finish");
  button.title=current==="glass"?"Switch to Classic finish":"Switch to Liquid Glass finish";
 }
 button.addEventListener("click",()=>{
  const current=document.documentElement.getAttribute(ATTRIBUTE);
  setFinish(current==="glass"?"classic":"glass",safeStorage(),document.documentElement);
  render();
 });
 nav.append(button);
 render();
}
const current=readFinish(safeStorage());
if(typeof document!=="undefined")document.documentElement.setAttribute(ATTRIBUTE,current);
if(typeof module==="object"&&module.exports)
 module.exports={KEY,readFinish,setFinish,labelFor};
if(typeof document!=="undefined"){
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",insertToggle,{once:true});
 else insertToggle();
}
})(typeof window!=="undefined"?window:globalThis);
