"""Build a reproducible, real-scene REVIEW QUEUE — NEVER auto ground truth.

These are candidate locations to verify with independent dated evidence.
Queries only the actual featurepack generated from Sentinel-2 source scenes.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from pyproj import Transformer
from scipy.ndimage import binary_erosion

CATEGORIES=(
 ("persistent_bare_hypothesis","Possible persistent bare surface",
  "Vegetation dropped after 2023 and low-green/bare spectral signal remains in 2026. Could also be harvested/uncultivated fields."),
 ("seasonal_regrowth_hypothesis","Possible seasonal vegetation recovery",
  "Vegetation dropped in 2025, recovered in 2026; 2021 WorldCover mapped this area as cropland."),
 ("stable_control_hypothesis","Possible unchanged comparison area",
  "Similar spectral response in 2023 and 2025. Still requires independent evidence that the surface stayed unchanged.")
)
PIXEL_BLOCK=25  # 25x10m = 250m, helps spread review points

def block_for(row,col):
    return f"block_r{row//PIXEL_BLOCK:02d}_c{col//PIXEL_BLOCK:02d}"

def classify_candidates(pack):
    wc=pack["worldcover"]
    study=pack["corridor"].astype(bool)
    valid=pack["joint_valid"].astype(bool)
    ndvi=[pack[f"ndvi_{i}"] for i in range(4)]
    bsi=[pack[f"bsi_{i}"] for i in range(4)]
    ndbi=[pack[f"ndbi_{i}"] for i in range(4)]
    initial=((ndvi[0]-ndvi[1] > .22) |
             ((bsi[1]-bsi[0] > .14)&(ndvi[0]-ndvi[1] > .12)))
    initial &= (ndvi[1] < .37) & (bsi[1] > -.12)
    persistent=valid & initial & (ndvi[2]<.34) & (ndvi[3]<.34)
    persistent &= (bsi[2] > -.13)&(bsi[3] > -.13)&(ndbi[1]>-.2)&(ndbi[3]>-.2)
    seasonal=valid & initial & (wc==40) & ((ndvi[2]>.42)|(ndvi[3]>.42))
    stable=valid & (abs(ndvi[0]-ndvi[1])<.07) & (abs(bsi[0]-bsi[1])<.09)
    stable &= (abs(ndvi[2]-ndvi[3])<.20)
    # The bare hypothesis is prioritised inside the mapped road buffer;
    # other categories may be outside, to avoid location-only learning.
    return {
      "persistent_bare_hypothesis":persistent & study,
      "seasonal_regrowth_hypothesis":seasonal & (~study),
      "stable_control_hypothesis":stable
    }

def choose_locations(masks, pack, per_class=8):
    # Use the study geometry from the scene, never hard-coded longitude.
    # The caller will convert selected row/col to geodetic coordinates.
    chosen=[]
    for category,label,explanation in CATEGORIES:
        mask=masks[category]
        # Prefer interior pixels rather than edge pixels, where mixed
        # spectra and resampling are more likely.
        eroded=binary_erosion(mask,structure=np.ones((3,3),dtype=bool))
        if np.count_nonzero(eroded) >= per_class:
            mask=eroded
        coords=np.argwhere(mask)
        # Pick at most one point per 250m block, sorted by block density,
        # deterministic tie break by pixel order.
        groups={}
        for r,c in coords:
            key=(int(r)//PIXEL_BLOCK,int(c)//PIXEL_BLOCK)
            groups.setdefault(key,[]).append((int(r),int(c)))
        order=sorted(groups,key=lambda key:(-len(groups[key]),key))
        for key in order[:per_class]:
            points=groups[key]
            center=(key[0]*PIXEL_BLOCK+PIXEL_BLOCK/2,
                    key[1]*PIXEL_BLOCK+PIXEL_BLOCK/2)
            r,c=min(points,key=lambda x:(x[0]-center[0])**2+(x[1]-center[1])**2)
            chosen.append({"category":category,
                           "title":label,"description":explanation,
                           "row":r,"col":c,"site_group_suggestion":block_for(r,c)})
    return chosen

def build(path, output, per_class=8):
    with np.load(path,allow_pickle=False) as pack:
        study_id=str(pack["study_id"].item())
        signature=str(pack["signature"].item())
        masks=classify_candidates(pack)
        points=choose_locations(masks,pack,per_class)
        origin_data=json.loads((Path(path).parent/"inspection_v05.json").read_text())
        geo=origin_data["grid"]
        tr=Transformer.from_crs("EPSG:32635","EPSG:4326",always_xy=True)
        for i,p in enumerate(points):
            x=geo["origin_easting"]+(p["col"]+.5)*geo["pixel_size_m"]
            y=geo["origin_northing"]-(p["row"]+.5)*geo["pixel_size_m"]
            lon,lat=tr.transform(x,y)
            p.update({"id":f"review-{i+1:03}",
                      "lat":round(float(lat),7),"lon":round(float(lon),7),
                      "worldcover_2021":int(pack["worldcover"][p["row"],p["col"]]),
                      "within_road_buffer":bool(pack["corridor"][p["row"],p["col"]]),
                      "site_group_suggestion":block_for(p["row"],p["col"])})
        payload={
            "status":"review_candidates_not_ground_truth",
            "study_id":study_id,"signature":signature,
            "method":"Deterministic selection from real Sentinel-2 multi-date spectral signatures",
            "candidate_count":len(points),
            "per_class_requested":per_class,
            "not_independent_validation":True,
            "all_unverified":True,
            "warning":"Candidate type is NOT a true class. None of these points are training labels until independent dated evidence is reviewed.",
            "date_window":"2023 → 2025 changes, independently checked against 2026 scenes",
            "items":points}
        Path(output).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
        return payload

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--features",default="site/features_v05.npz")
    a.add_argument("--output",default="site/review_queue_v06.json")
    a.add_argument("--per-class",type=int,default=8)
    args=a.parse_args()
    payload=build(args.features,args.output,args.per_class)
    print(json.dumps({k:v for k,v in payload.items() if k!="items"},indent=2))

if __name__=="__main__":
    main()
