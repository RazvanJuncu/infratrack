"""Build a multi-region real-satellite research portfolio without synthetic observations.

Per-site isolation: one unavailable provider/scene never turns a site into a
fabricated ready state. Maps and four-date sample data are all sourced.
"""
import argparse
import json
import shutil
from pathlib import Path
from xml.etree import ElementTree as ET
import numpy as np
import requests
from pyproj import Transformer
from rasterio.transform import from_origin
from PIL import Image
from corridor_osm import corridor_raster, aoi_bounds
from infratrack import select_scene, rgb_image, read_worldcover
from feature_v05 import create_featurepack
from spectral_v04 import triage, render_rgba, report
from scripts.build_review_queue import build as build_queue
from scripts.train_validation import produce

UA="InfraTrack research (https://github.com/RazvanJuncu/infratrack)"
PERIODS=[
 ("before","2023-06-01/2023-09-30"),
 ("after","2025-06-01/2025-09-30"),
 ("spring","2026-04-01/2026-06-30"),
 ("followup","2026-07-01/2026-09-30")
]
IMAGE_ROOT_FILES=(
 "before.png","after.png","corridor.geojson","data.json",
 "inspection_v05.json","features_v05.npz","review_queue_v06.json",
 "validation_v05.json","spectral_candidates.png","spectral_preview.png"
)

def osm_way(way_id,ref,center_lat,center_lon):
    url=f"https://api.openstreetmap.org/api/0.6/way/{way_id}/full"
    resp=requests.get(url,headers={"User-Agent":UA},timeout=13)
    resp.raise_for_status()
    root=ET.fromstring(resp.content)
    nodes={n.attrib["id"]:[float(n.attrib["lon"]),float(n.attrib["lat"])]
           for n in root.findall("node")}
    w=next(w for w in root.findall("way") if w.attrib.get("id")==str(way_id))
    tags={tag.attrib["k"]:tag.attrib["v"] for tag in w.findall("tag")}
    refs=tags.get("ref","").replace(" ","").split(";")
    if ref not in refs or tags.get("highway") not in ("motorway","construction"):
        raise ValueError(f"OSM way {way_id} does not currently identify a mapped {ref} motorway")
    points=[nodes[nd.attrib["ref"]] for nd in w.findall("nd") if nd.attrib["ref"] in nodes]
    if len(points)<2:
        raise ValueError(f"OSM way {way_id}: no geometry")
    if not any(abs(p[1]-center_lat)<.08 and abs(p[0]-center_lon)<.13 for p in points):
        raise ValueError(f"OSM way {way_id} outside project's declared geographic area")
    return {"type":"Feature","geometry":{"type":"LineString","coordinates":points},
            "properties":{"osm_way_id":int(way_id),"ref":ref,
                          "highway":tags["highway"],"name":tags.get("name",""),
                          "source_url":url}}

def route_for(site):
    items=[]
    errors=[]
    for way_id in site.get("osm_way_ids",[])[:8]:
        try:items.append(osm_way(way_id,site["ref"],site["lat"],site["lon"]))
        except Exception as err:errors.append(f"{way_id}: {str(err)[:100]}")
    return {"type":"FeatureCollection","features":items},{
       "source":"OpenStreetMap way/full · ODbL",
       "requested_ids":site.get("osm_way_ids",[])[:8],
       "mapped_ids":[f["properties"]["osm_way_id"] for f in items],
       "retrieval_errors":errors,
       "engineering_alignment_verified":False}

def valid_config(sites):
    ids=set()
    for site in sites:
        name=site["id"]
        if not name.replace("-","").isalnum() or name in ids or not(.1<=site.get("size_km",2)<=3):
            raise ValueError(f"Invalid region id/size: {name}")
        if not (43<=site["lat"]<=48 and 20<=site["lon"]<=30):
            raise ValueError(f"Region center outside expected Romania bounds: {name}")
        if site["ref"] not in ("A0","A1","A7"):
            raise ValueError(f"Unapproved motorway ref: {site['ref']}")
        ids.add(name)
    return sites

def processed_status(site,output,detail):
    status={"id":site["id"],"name":site["name"],"region":site["region"],
            "ref":site["ref"],"lat":site["lat"],"lon":site["lon"],
            "size_km":site.get("size_km",2),"project_source":site.get("project_source"),
            "status":detail["status"],"path":f"projects/{site['id']}/",
            "notes":detail.get("notes"),"data_url":f"projects/{site['id']}/data.json"}
    if detail["status"]=="ready":
        status.update({k:detail[k] for k in ("scene_count","first_date","last_date",
                                            "review_candidates","scene_signature",
                                            "road_geometry_status")})
    return status

def build_one(site,root,cloud):
    output=root/"projects"/site["id"]
    output.mkdir(parents=True,exist_ok=True)
    n=int(site.get("size_km",2)*100)
    meters=n*10
    tr=Transformer.from_crs("EPSG:4326","EPSG:32635",always_xy=True)
    x,y=tr.transform(site["lon"],site["lat"])
    transform=from_origin(x-meters/2,y+meters/2,10,10)
    route,source=route_for(site)
    road_mask=corridor_raster(route,transform,n)
    # With no retrieved motorway geometry, allow REAL area exploration,
    # but explicitly DO NOT claim candidate pixels are near that road.
    mapped=bool(road_mask.any())
    analysis_mask=road_mask if mapped else np.ones((n,n),dtype=bool)
    scenes=[]
    for tag,period in PERIODS:
        print(f"  {site['id']} {tag}: searching Sentinel {period}",flush=True)
        item,bands,scl=select_scene(site["lat"],site["lon"],meters,n,period,
                                    cloud,transform)
        scenes.append((item,bands,scl))
    worldcover,wc_source=read_worldcover(site["lat"],site["lon"],transform,n)
    scenes_2023,scenes_2025,scenes_2026_spring,scenes_2026_summer=scenes
    results=triage(
        scenes_2023[1],scenes_2025[1],scenes_2026_spring[1],scenes_2026_summer[1],
        scenes_2023[2],scenes_2025[2],scenes_2026_spring[2],scenes_2026_summer[2],
        analysis_mask,worldcover)
    cover=report(results)
    before_img=rgb_image(scenes_2023[1])
    after_img=rgb_image(scenes_2025[1])
    Image.fromarray(before_img,"RGB").save(output/"before.png",optimize=True)
    Image.fromarray(after_img,"RGB").save(output/"after.png",optimize=True)
    colors=render_rgba(results)
    Image.fromarray(colors,"RGBA").save(output/"spectral_candidates.png",optimize=True)
    alpha=colors[:,:,3:4].astype(np.float32)/255
    preview=(after_img.astype(np.float32)*(1-alpha)+colors[:,:,:3].astype(np.float32)*alpha).astype(np.uint8)
    Image.fromarray(preview,"RGB").save(output/"spectral_preview.png",optimize=True)
    (output/"corridor.geojson").write_text(json.dumps(route),encoding="utf-8")
    pack=create_featurepack(output,transform,scenes,worldcover,analysis_mask,source,
                             study_id=site["id"]+"-2km-v1")
    queue=build_queue(output/"features_v05.npz",output/"review_queue_v06.json",per_class=8)
    validation=produce(output/"features_v05.npz",Path("labels/reviewed.jsonl"),
                       output/"validation_v05.json",output/"model_predictions_v05.png")
    metadata={
        "status":"ready","id":site["id"],"title":site["name"],
        "site":{"lat":site["lat"],"lon":site["lon"],"size_km":site.get("size_km",2),
                "bounds":aoi_bounds(site["lon"],site["lat"],meters)},
        "source":"Copernicus Sentinel-2 L2A via Element84 Earth Search",
        "worldcover_url":wc_source,
        "dates":[{"id":item["id"],"date":item["properties"]["datetime"][:10]}
                 for item,_,_ in scenes],
        "v05":pack,
        "v04":cover,
        "road":{"geometry_status":"mapped_osm_research" if mapped else "area_only_no_verified_motorway_alignment",
                "mapped_segments":len(route["features"]),
                "osm_provenance":source,
                "buffer_m":130 if mapped else None},
        "review_candidates":queue["candidate_count"],
        "validation_status":validation["status"],
        "warning":"Unvalidated surface classifications only. No verified construction or completion percentage."
    }
    (output/"data.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding="utf-8")
    return {
        "status":"ready","notes":metadata["road"]["geometry_status"],
        "scene_count":len(scenes),
        "first_date":metadata["dates"][0]["date"],
        "last_date":metadata["dates"][-1]["date"],
        "review_candidates":queue["candidate_count"],
        "scene_signature":pack["signature"],
        "road_geometry_status":metadata["road"]["geometry_status"]
    }

def copy_original(root,site):
    dest=root/"projects"/site["id"]
    dest.mkdir(parents=True,exist_ok=True)
    for name in IMAGE_ROOT_FILES:
        src=root/name
        if src.exists():shutil.copyfile(src,dest/name)
    data=json.loads((root/"data.json").read_text(encoding="utf-8"))
    if data.get("status")!="ready" or data.get("v05",{}).get("status")!="ready":
        raise RuntimeError("Previous A0 anchor failed to obtain real four-scene data")
    queue=json.loads((dest/"review_queue_v06.json").read_text(encoding="utf-8"))
    if queue.get("signature")!=data["v05"]["signature"]:
        raise RuntimeError("A0 anchor scene provenance mismatch")
    return {"status":"ready","notes":"Mapped A0 pilot, not full lot",
        "scene_count":4,"first_date":data["before"]["date"],"last_date":data["interpretation"]["followup"]["date"],
        "review_candidates":queue["candidate_count"],
        "scene_signature":data["v05"]["signature"],
        "road_geometry_status":"mapped_osm_research"}

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--config",default="projects/regions.json")
    a.add_argument("--output",default="site")
    a.add_argument("--max-cloud",type=float,default=50)
    args=a.parse_args()
    root=Path(args.output)
    sites=valid_config(json.loads(Path(args.config).read_text(encoding="utf-8"))["sites"])
    entries=[]
    for site in sites:
        print(f"MULTI-SITE {site['id']} {site['name']}",flush=True)
        try:
            detail=copy_original(root,site) if site.get("use_anchor") else build_one(site,root,args.max_cloud)
        except Exception as err:
            detail={"status":"unavailable","notes":str(err)[:350]}
            p=root/"projects"/site["id"]
            p.mkdir(parents=True,exist_ok=True)
            (p/"data.json").write_text(json.dumps(detail,ensure_ascii=False,indent=2),encoding="utf-8")
            print(f"MULTI-SITE UNAVAILABLE {site['id']}: {err}",flush=True)
        entries.append(processed_status(site,root,detail))
    manifest={
       "version":"0.7","source":"Real Sentinel-2 L2A / OSM map research",
       "site_count":len(entries),"ready_count":sum(x["status"]=="ready" for x in entries),
       "sites":entries,
       "warning":"Sites have independent imagery; candidates are NOT verified construction or labeled ground truth."
    }
    (root/"projects.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print("MULTI-SITE RESULT",json.dumps({"total":manifest["site_count"],"ready":manifest["ready_count"],
                 "statuses":[[x["id"],x["status"],x["notes"]] for x in entries]},ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()
