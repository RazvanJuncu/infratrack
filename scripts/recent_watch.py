"""Recent real Sentinel-2 monitoring snapshots for registered study sites.

This is NOT construction detection or ground truth. It identifies significant,
cloud-cleared *spectral* changes for human review on 2x2km windows.
"""
from __future__ import annotations
import argparse
import json
from datetime import datetime,timedelta,timezone
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin
from scipy.ndimage import uniform_filter
from infratrack import search_scenes, read_band, rgb_image

BANDS=("red","green","blue","nir","scl")
CRS="EPSG:32635"  # Registered Romanian pilot sites only; Europe custom areas use live STAC metadata.
UA="InfraTrack recent Sentinel-2 research"
LOOKBACK_DAYS=115
MAX_READ_ATTEMPTS=14
SIGNAL_THRESHOLD=.19

def iso_date(item):
    return item["properties"]["datetime"][:10]

def pick_scene(items, transform, pixels, cloud_limit=65, min_clear=.62):
    errors=[]
    for item in items[:MAX_READ_ATTEMPTS]:
        try:
            if any(name not in item.get("assets",{}) for name in BANDS):
                continue
            scene={name:read_band(item,name,transform,pixels) for name in BANDS[:-1]}
            scl=read_band(item,"scl",transform,pixels,nearest=True)
            good=np.isin(scl,[4,5,6])&np.isfinite(scene["nir"])&np.isfinite(scene["red"])
            if float(good.mean())<min_clear:
                errors.append(f"{item['id']}: clear {good.mean():.0%}")
                continue
            return (item,scene,scl)
        except Exception as exc:
            errors.append(f"{item.get('id','unknown')}: {str(exc)[:100]}")
    raise RuntimeError("No adequately cloud-free, readable scene. "+", ".join(errors[-4:]))

def valid_pair(before,after):
    a,b=before,after
    clear=np.isin(a[2],[4,5,6])&np.isin(b[2],[4,5,6])
    for item in (a,b):
        for k in ("red","nir","green","blue"):
            clear &= np.isfinite(item[1][k]) & (item[1][k]>=0)
    return clear

def significance(before,after):
    good=valid_pair(before,after)
    def ndvi(scene):
        bands=scene[1]
        return (bands["nir"]-bands["red"])/(bands["nir"]+bands["red"]+1e-6)
    v0,v1=ndvi(before),ndvi(after)
    rgb0=np.stack([before[1][k] for k in ("red","green","blue")],axis=-1)
    rgb1=np.stack([after[1][k] for k in ("red","green","blue")],axis=-1)
    color=np.mean(np.abs(rgb1-rgb0),axis=-1)
    score=np.maximum(np.abs(v1-v0),color*2.5)
    score[~good]=0
    return score,good,v0,v1

def site_candidates(score,good,study,transform,dates,per_site=12):
    if not 0<=per_site<=40:raise ValueError("Too many review candidates")
    # 200m blocks = group spatially spread, do not submit 12 adjacent pixels.
    # Prefer substantial and spatially coherent changes using mean score in 5x5 patch.
    local=uniform_filter(score,size=5,mode="nearest")
    valid_fraction=uniform_filter(good.astype(np.float32),size=5,mode="nearest")
    local[(valid_fraction<.8)|(~good)]=0
    items=[]
    crs=Transformer.from_crs(CRS,"EPSG:4326",always_xy=True)
    height,width=score.shape
    for top in range(0,height,20):
        for left in range(0,width,20):
            cropped=local[top:min(top+20,height),left:min(left+20,width)]
            if not cropped.size:continue
            loc=np.unravel_index(int(np.argmax(cropped)),cropped.shape)
            row,col=top+loc[0],left+loc[1]
            val=float(cropped[loc])
            if val<SIGNAL_THRESHOLD:continue
            east,north=transform*(col+.5,row+.5)
            lon,lat=crs.transform(east,north)
            items.append({
                "row":int(row),"col":int(col),
                "lat":round(lat,7),"lon":round(lon,7),
                "signal_strength":round(val,3),
                "site_group_suggestion":f"{study}_r{top//20:02d}_c{left//20:02d}",
                "type":"unverified_spectral_change",
                "before_date":dates[0],"after_date":dates[1]
            })
    items.sort(key=lambda i:(-i["signal_strength"],i["row"],i["col"]))
    for index,item in enumerate(items[:per_site]):
        item["id"]=f"{study}-recent-{index+1:02d}"
    return items[:per_site]

def metadata(site,output,status,**details):
    return {"study_id":site["id"],"study_name":site["name"],
            "status":status,"source":"Copernicus Sentinel-2 L2A via Element84 Earth Search",
            "analysis_extent_km":site.get("size_km",2),
            "automatic_construction_detection":False,
            "warning":"Spectral changes are NOT verified construction or land-use labels; may reflect crops, lighting, water, earthworks or other causes. Independent human/evidence validation required.",
            **details}

def run_site(site, output, now=None):
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    now=now or datetime.now(timezone.utc)
    size=int(site.get("size_km",2)*100)
    lat,lon=site["lat"],site["lon"]
    t=Transformer.from_crs("EPSG:4326",CRS,always_xy=True)
    x,y=t.transform(lon,lat)
    transform=from_origin(x-size*5,y+size*5,10,10)
    from_date=(now-timedelta(days=LOOKBACK_DAYS)).date().isoformat()
    to_date=now.date().isoformat()
    sources=search_scenes(lat,lon,size*10,f"{from_date}/{to_date}",65)
    # Read latest locally clear view first, not minimum global cloud date.
    sources.sort(key=lambda item:item["properties"]["datetime"],reverse=True)
    used=[]
    attempted=set()
    errors=[]
    for item in sources[:MAX_READ_ATTEMPTS]:
        if item["id"] in attempted:continue
        attempted.add(item["id"])
        if used and abs((datetime.fromisoformat(iso_date(used[0][0]))-
                         datetime.fromisoformat(iso_date(item))).days)<7:
            continue
        try:
            scene=pick_scene([item],transform,size)
            used.append(scene)
            if len(used)==2:break
        except RuntimeError as exc: errors.append(str(exc)[:120])
    if len(used)<2:
        value=metadata(site,output,"insufficient_clear_observations",
                       checked_from=from_date,checked_through=to_date,
                       candidate_scene_count=len(sources),read_errors=errors[-5:])
        (output/"recent.json").write_text(json.dumps(value,indent=2),encoding="utf-8")
        return value
    # Newest -> oldest order from STAC; analysis is older -> newer
    before,after=used[1],used[0]
    score,good,nd0,nd1=significance(before,after)
    if float(good.mean())<.4:
        value=metadata(site,output,"insufficient_clear_overlap",
                       checked_from=from_date,checked_through=to_date,
                       joint_clear_percent=round(float(good.mean())*100,1))
        (output/"recent.json").write_text(json.dumps(value,indent=2),encoding="utf-8")
        return value
    for fname,src in [("recent_before.png",before),("recent_after.png",after)]:
        Image.fromarray(rgb_image(src[1]),"RGB").save(output/fname,optimize=True)
    dates=[iso_date(before[0]),iso_date(after[0])]
    items=site_candidates(score,good,site["id"],transform,dates)
    queue={"status":"unverified_recent_changes","study_id":site["id"],
           "scene_signature":__import__("hashlib").sha256(
                "|".join(i[0]["id"] for i in (before,after)).encode()).hexdigest()[:16],
           "dates":dates,"items":items,"candidate_count":len(items),
           "classes_assigned":False,"training_eligible":False,
           "selection":"5x5 mean of absolute NDVI or true-color reflectance change, 200m separate blocks",
           "score_threshold":SIGNAL_THRESHOLD,
           "warning":"Only spectral changes; NOT confirmed construction, farming, demolition or other cause."}
    (output/"recent_queue.json").write_text(json.dumps(queue,indent=2),encoding="utf-8")
    value=metadata(site,output,"ready",
                   checked_from=from_date,checked_through=to_date,
                   before_date=dates[0],after_date=dates[1],
                   before_scene_id=before[0]["id"],after_scene_id=after[0]["id"],
                   joint_clear_percent=round(float(good.mean())*100,1),
                   significant_candidate_count=len(items),
                   significant_pixel_percent=round(float(((score>SIGNAL_THRESHOLD)&good).sum())/max(1,int(good.sum()))*100,1),
                   queue_file="recent_queue.json",
                   image_files=["recent_before.png","recent_after.png"],
                   observation_signature=queue["scene_signature"],
                   candidate_scene_count=len(sources))
    (output/"recent.json").write_text(json.dumps(value,indent=2),encoding="utf-8")
    return value

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--config",default="projects/regions.json")
    p.add_argument("--output",default="site")
    args=p.parse_args()
    root=Path(args.output)
    cfg=json.loads(Path(args.config).read_text(encoding="utf-8"))
    summary=[]
    for site in cfg["sites"]:
        path=root/"projects"/site["id"]
        print(f"RECENT-WATCH {site['id']} starting",flush=True)
        try:
            result=run_site(site,path)
        except Exception as exc:
            result=metadata(site,path,"unavailable",error=str(exc)[:300])
            path.mkdir(parents=True,exist_ok=True)
            (path/"recent.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
        summary.append({"id":site["id"],"name":site["name"],
                        "status":result["status"],
                        "before_date":result.get("before_date"),
                        "after_date":result.get("after_date"),
                        "candidate_count":result.get("significant_candidate_count",0)})
        print("RECENT-WATCH RESULT",json.dumps(summary[-1],ensure_ascii=False),flush=True)
    payload={"status":"real_satellite_monitoring_manifest",
             "source":"Copernicus Sentinel-2 L2A",
             "checked_at_utc":datetime.now(timezone.utc).isoformat(),
             "study_count":len(summary),"sites":summary,
             "description":"Recent cloud-screened research observations from last 115 days, not guaranteed 5-day usable cadence."}
    (root/"recent_manifest.json").write_text(json.dumps(payload,indent=2,ensure_ascii=False),encoding="utf-8")
    print("RECENT-WATCH TOTAL",sum(s["status"]=="ready" for s in summary),"of",len(summary),flush=True)

if __name__=="__main__":
    main()
