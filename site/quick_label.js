/*
 * InfraTrack Quick Review — browser-only provisional labels.
 * Fast human impressions NEVER become training ground truth.
 * No network write, no API keys, no server.
 */
(function (global) {
  "use strict";
  const CLASS_NAMES = Object.freeze(["construction", "agriculture", "unchanged", "unsure"]);
  const STORE_PREFIX = "infratrack:quick-review:v1:";

  function pixelKey(item) {
    if (!item || !Number.isInteger(item.row) || !Number.isInteger(item.col)) {
      throw new Error("A candidate must have integer pixel coordinates");
    }
    return item.row + ":" + item.col;
  }
  function storageKey(studyId, signature) {
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(studyId) || !/^[a-f0-9]{16}$/.test(signature)) {
      throw new Error("Invalid satellite study or provenance signature");
    }
    return STORE_PREFIX + studyId + ":" + signature;
  }
  function acceptedDraft(item, candidate, studyId, signature) {
    return item && item.status === "provisional_not_ground_truth"
      && item.study_id === studyId && item.signature === signature
      && item.row === candidate.row && item.col === candidate.col
      && CLASS_NAMES.includes(item.label);
  }
  function readDrafts(storage, studyId, signature, candidates) {
    const byPixel = {};
    const allowed = new Map(candidates.map(item => [pixelKey(item), item]));
    if (!storage) return byPixel;
    let raw;
    try { raw = storage.getItem(storageKey(studyId, signature)); }
    catch (_) { return byPixel; }
    if (!raw) return byPixel;
    try {
      const payload = JSON.parse(raw);
      if (payload.type !== "provisional_review" ||
          payload.study_id !== studyId || payload.signature !== signature ||
          !Array.isArray(payload.items)) return byPixel;
      for (const draft of payload.items) {
        const key = pixelKey(draft);
        const source = allowed.get(key);
        if (source && acceptedDraft(draft, source, studyId, signature)) byPixel[key] = draft;
      }
    } catch (_) { /* invalid local data is not used */ }
    return byPixel;
  }
  function asPayload(byPixel, studyId, signature) {
    return {
      type: "provisional_review", study_id: studyId, signature: signature,
      eligible_for_training: false, verified_count: 0,
      disclaimer: "Unverified user impressions. NOT training labels. Require independent dated evidence.",
      items: Object.values(byPixel).sort((a,b) => a.row - b.row || a.col - b.col)
    };
  }
  function nextUnreviewed(candidates, byPixel, startIndex) {
    if (!candidates.length) return -1;
    for (let n = 1; n <= candidates.length; n++) {
      const i = (startIndex + n) % candidates.length;
      if (!Object.prototype.hasOwnProperty.call(byPixel, pixelKey(candidates[i]))) return i;
    }
    return -1;
  }
  function countDrafts(candidates, byPixel) {
    const unique = new Set(candidates.map(pixelKey));
    return Object.keys(byPixel).filter(k => unique.has(k)).length;
  }

  // Testable pure helpers, without DOM/storage side effects.
  const core = {CLASS_NAMES, pixelKey, storageKey, readDrafts, asPayload,
                nextUnreviewed, countDrafts};
  if (typeof module === "object" && module.exports) module.exports = core;

  if (!global.document) return;
  const document = global.document;

  function createApp(config) {
    const queue = config.queue;
    const pack = config.pack;
    if (!queue || !pack || queue.signature !== pack.signature
          || queue.study_id !== pack.study_id || !Array.isArray(queue.items)) {
      throw new Error("Queue and real Sentinel scene measurements do not match");
    }
    const candidates = queue.items.slice();
    const get = id => document.getElementById(id);
    let storage = null;
    try { storage = global.localStorage; const probe = "__infratrack_probe";
          storage.setItem(probe,"1"); storage.removeItem(probe); }
    catch (_) { storage = null; }
    let drafts = readDrafts(storage, pack.study_id, pack.signature, candidates);
    const history = [];
    let index = candidates.length ? Math.max(0,nextUnreviewed(candidates,drafts,-1)) : -1;
    let feedback = "";
    const images = [new Image(),new Image()];
    const prefix = config.assetPrefix || "";
    if (!/^(?:projects\/[a-z0-9-]+\/)?$/.test(prefix)) {
      throw new Error("Invalid local satellite asset folder");
    }
    images[0].src = prefix+"before.png";
    images[1].src = prefix+"after.png";
    images.forEach(img => {
      img.onload = () => renderPreview();
      img.onerror = () => { get("quickImageWarning").textContent =
        "Satellite preview image unavailable. Measurements remain accessible."; };
    });

    const controls = {
      "quickConstruction":"construction","quickAgriculture":"agriculture",
      "quickUnchanged":"unchanged","quickUnsure":"unsure"
    };
    for (const [id,label] of Object.entries(controls)) {
      get(id).onclick = () => record(label);
    }
    get("quickPrev").onclick = () => navigate(-1);
    get("quickNext").onclick = () => navigate(1);
    get("quickUndo").onclick = undo;
    get("quickExport").onclick = exportDrafts;
    get("quickVerify").onclick = verify;

    function current() { return index >= 0 ? candidates[index] : null; }

    function writeStorage() {
      if (!storage) {
        get("quickPersistence").textContent =
          "Browser storage unavailable. Answers only last until refresh; export a backup.";
        return false;
      }
      try {
        storage.setItem(storageKey(pack.study_id, pack.signature),
                        JSON.stringify(asPayload(drafts, pack.study_id, pack.signature)));
        get("quickPersistence").textContent =
          "Saved on this browser only. Not synced to GitHub or AI training.";
        return true;
      } catch (err) {
        get("quickPersistence").textContent =
          "Could not save to browser. Export answers before leaving this page.";
        return false;
      }
    }

    function select(indexNext, navigateMap=true) {
      index = Math.max(0,Math.min(candidates.length-1,indexNext));
      const item = current();
      if (item && typeof config.onSelect === "function") config.onSelect(item,navigateMap);
      render();
    }
    function navigate(step) {
      if (!candidates.length) return;
      feedback = "";
      select((index + step + candidates.length) % candidates.length);
    }
    function record(label) {
      const item = current();
      if (!item || !CLASS_NAMES.includes(label)) return;
      const key = pixelKey(item);
      history.push({key, previous:drafts[key] || null, index:index});
      drafts[key] = {
        row:item.row,col:item.col, label:label,
        study_id:pack.study_id, signature:pack.signature,
        candidate_id:item.id,
        status:"provisional_not_ground_truth",
        annotated_at:new Date().toISOString(),
        evidence_url:null,training_eligible:false
      };
      writeStorage();
      feedback = (label==="unsure" ? "Marked unsure — excluded from training." :
                 "Saved as a draft — not used for training.") +
                 " Next suggestion selected.";
      const next = nextUnreviewed(candidates,drafts,index);
      if (next>=0) select(next);
      else render();
    }
    function undo() {
      const edit = history.pop();
      if (!edit) {feedback="Nothing to undo from this session.";render();return;}
      if (edit.previous) drafts[edit.key] = edit.previous;
      else delete drafts[edit.key];
      writeStorage();
      feedback="Previous response restored.";
      select(edit.index);
    }
    function verify() {
      const item = current();
      const draft = item && drafts[pixelKey(item)];
      if (!draft || draft.label==="unsure") {
        feedback="Choose Construction, Agriculture or Unchanged first. Unsure cannot be verified.";
        render();return;
      }
      if (typeof config.onVerify === "function") config.onVerify(item,draft.label);
      feedback="Verification needs independent dated evidence. Drafts alone never train the model.";
      render();
    }
    function exportDrafts() {
      const serialized = JSON.stringify(asPayload(drafts,pack.study_id,pack.signature),null,2);
      const blob = new Blob([serialized],{type:"application/json"});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href=url;
      anchor.download="infratrack-provisional-"+pack.signature+".json";
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      feedback="Backup exported. This JSON is not a training dataset.";
      render();
    }
    function draw(canvasId,img,item) {
      const canvas=get(canvasId),ctx=canvas.getContext("2d");
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if (!img.complete || !img.naturalWidth) {
        ctx.fillStyle="#0e2430";ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle="#adcad3";ctx.font="14px system-ui";
        ctx.fillText("Loading real satellite image…",16,30);return;
      }
      // Show a ~480x480m region centred on one 10m pixel, from original
      // 200x200 real raster. No generated or inferred pixels.
      const span=48, radius=span/2;
      const x=Math.max(0,Math.min(img.naturalWidth-span,item.col-radius));
      const y=Math.max(0,Math.min(img.naturalHeight-span,item.row-radius));
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(img,x,y,span,span,0,0,canvas.width,canvas.height);
      const px=(item.col+0.5-x)/span*canvas.width;
      const py=(item.row+0.5-y)/span*canvas.height;
      const half=canvas.width/span/2;
      ctx.strokeStyle="#fff";ctx.lineWidth=2.4;
      ctx.strokeRect(px-half,py-half,half*2,half*2);
      ctx.strokeStyle="#ffb549";ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(px-14,py);ctx.lineTo(px-6,py);
      ctx.moveTo(px+6,py);ctx.lineTo(px+14,py);
      ctx.moveTo(px,py-14);ctx.lineTo(px,py-6);
      ctx.moveTo(px,py+6);ctx.lineTo(px,py+14);ctx.stroke();
    }
    function renderPreview() {
      const item=current();
      if (!item) return;
      draw("quickBefore",images[0],item);
      draw("quickAfter",images[1],item);
    }
    function render() {
      const item=current();
      const reviewed=countDrafts(candidates,drafts);
      get("quickProgress").textContent=reviewed+" / "+candidates.length+" reviewed";
      get("quickProgressBar").style.width=
        (candidates.length ? 100*reviewed/candidates.length : 0)+"%";
      get("quickUndo").disabled=!history.length;
      get("quickPrev").disabled=!candidates.length;
      get("quickNext").disabled=!candidates.length;
      get("quickExport").disabled=!reviewed;
      Object.keys(controls).forEach(id=>get(id).disabled=!item);
      get("quickReviewStatus").textContent=feedback ||
        "Fast choices are provisional. Only source-verified labels can train the AI.";
      if (!item) {
        get("quickCandidateName").textContent="No candidate points were loaded";
        get("quickCandidateDetail").textContent="Satellite observations not ready.";
        get("quickVerify").disabled=true;
        return;
      }
      const draft=drafts[pixelKey(item)];
      get("quickCandidateName").textContent=
        "Example "+(index+1)+" of "+candidates.length+" · "+item.title;
      get("quickCandidateDetail").textContent=
        item.id+" · row "+item.row+", col "+item.col+
        " · "+(item.within_road_buffer?"Near mapped A0":"Outside mapped corridor");
      get("quickDraftState").textContent=draft?
        "Your draft: "+draft.label.toUpperCase()+" · unverified":"Not classified yet";
      get("quickVerify").disabled=!draft || draft.label==="unsure";
      for(const [id,label] of Object.entries(controls)) {
        get(id).classList.toggle("chosen",Boolean(draft && draft.label===label));
      }
      get("quickBeforeDate").textContent=pack.dates?.[0]?.date || "Before";
      get("quickAfterDate").textContent=pack.dates?.[1]?.date || "After";
      renderPreview();
    }
    writeStorage(); // Also explicitly displays whether persistence is available.
    if (candidates.length) select(index,false); else render();
    return {select,render,record,undo,exportDrafts,
            getDrafts:()=>asPayload(drafts,pack.study_id,pack.signature)};
  }

  global.InfraQuickLabel={createApp,core};
})(typeof window !== "undefined" ? window : globalThis);
