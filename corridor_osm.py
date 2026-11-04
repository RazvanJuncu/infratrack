"""OpenStreetMap A0 Nord Lot 3 alignment with source provenance.
Mapped geometry is research context, not an authoritative engineering survey.
"""
import json
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import requests
from pyproj import Transformer
from rasterio.features import rasterize
from scipy.ndimage import binary_dilation

# Discovered by a source-tagged OSM Overpass query on 2026-11-04.
# Both carriageways. It is intentionally NOT a global 'A0' motorway search.
WAY_IDS = [
    254738263, 285740036, 697840869, 697840870, 697840871,
    697840872, 1164871800, 1164871801, 1164871802, 1164871803,
    1517261128, 1517261129, 1517261130, 1517261131,
    1339845940, 1339845942, 1569218882
]
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "InfraTrack/0.3 (https://github.com/RazvanJuncu/infratrack)"
FALLBACK_ID = 1517261128

def _valid_osm_way(element):
    tags = element.get("tags", {})
    return (
        int(element.get("id", 0)) in WAY_IDS
        and tags.get("ref") == "A0"
        and tags.get("highway") in ("motorway", "construction")
        and "geometry" in element and len(element["geometry"]) >= 2
    )

def _features(elements):
    features = []
    for item in elements:
        if not _valid_osm_way(item):
            continue
        coords = [[float(p["lon"]), float(p["lat"])] for p in item["geometry"]]
        if any(not(26.1 <= x <= 26.5 and 44.40 <= y <= 44.62) for x,y in coords):
            continue
        features.append({"type":"Feature",
                         "geometry":{"type":"LineString","coordinates":coords},
                         "properties":{"osm_way_id":item["id"],
                                       "source":"OpenStreetMap",
                                       "ref":"A0","name":item["tags"].get("name",""),
                                       "highway":item["tags"].get("highway","")}})
    return {"type":"FeatureCollection","features":features}

def fetch_route():
    """Get mapped OSM ways without inventing geometry; use one-way fallback if needed."""
    query = f'[out:json][timeout:30];way(id:{",".join(str(i) for i in WAY_IDS)});out geom;'
    try:
        response = requests.post(OVERPASS, data={"data":query},
            headers={"User-Agent":UA},timeout=50)
        response.raise_for_status()
        features = _features(response.json().get("elements",[]))
        if features["features"]:
            return features, {"source":"OpenStreetMap/Overpass",
                "query_url":"https://overpass-api.de/api/interpreter",
                "fetched_way_ids":[f["properties"]["osm_way_id"] for f in features["features"]],
                "complete_lot_verified":False}
    except Exception as exc:
        print(f"OSM Overpass unavailable: {exc}",flush=True)
    # OSM official API fallback. Fetch 7 well-defined centerline ways of
    # the lot, not the full regional motorway. A failed way remains absent.
    selected = [1164871800, 1164871801, 254738263, 1517261128,
                697840869, 697840870, 1339845940]
    recovered=[]
    for way_id in selected:
        try:
            url=f"https://api.openstreetmap.org/api/0.6/way/{way_id}/full"
            response=requests.get(url,headers={"User-Agent":UA},timeout=16)
            response.raise_for_status()
            root=ET.fromstring(response.content)
            nodes={e.attrib["id"]:[float(e.attrib["lon"]),float(e.attrib["lat"])]
                   for e in root.findall("node")}
            way=next(w for w in root.findall("way") if w.attrib["id"]==str(way_id))
            tags={e.attrib["k"]:e.attrib["v"] for e in way.findall("tag")}
            geom=[{"lon":nodes[n.attrib["ref"]][0],"lat":nodes[n.attrib["ref"]][1]}
                  for n in way.findall("nd") if n.attrib["ref"] in nodes]
            recovered.append({"id":way_id,"tags":tags,"geometry":geom})
        except Exception as exc:
            print(f"OSM way {way_id} retrieval unavailable: {str(exc)[:120]}",flush=True)
    geometry=_features(recovered)
    if geometry["features"]:
        return geometry,{"source":"OpenStreetMap/0.6 way/full fallback",
            "query_url":"https://api.openstreetmap.org/api/0.6/way/{way_id}/full",
            "fetched_way_ids":[f["properties"]["osm_way_id"] for f in geometry["features"]],
            "complete_lot_verified":False}
    return {"type":"FeatureCollection","features":[]},{"source":"unavailable",
        "fetched_way_ids":[],"complete_lot_verified":False}

def corridor_raster(features,transform,pixels,buffer_m=130,pixel_m=10):
    shapes=[]
    transformer=Transformer.from_crs("EPSG:4326","EPSG:32635",always_xy=True)
    for item in features.get("features",[]):
        coords=[transformer.transform(*point) for point in item["geometry"]["coordinates"]]
        if len(coords)>1:
            shapes.append(({"type":"LineString","coordinates":coords},1))
    if not shapes:
        return np.zeros((pixels,pixels),dtype=bool)
    source=rasterize(shapes,out_shape=(pixels,pixels),transform=transform,fill=0,dtype="uint8").astype(bool)
    radius=max(1,int(round(buffer_m/pixel_m)))
    yy,xx=np.ogrid[-radius:radius+1,-radius:radius+1]
    disk=xx*xx+yy*yy<=radius*radius
    return binary_dilation(source,structure=disk)

def aoi_bounds(lon,lat,size_m):
    tr=Transformer.from_crs("EPSG:4326","EPSG:32635",always_xy=True)
    inv=Transformer.from_crs("EPSG:32635","EPSG:4326",always_xy=True)
    x,y=tr.transform(lon,lat)
    west,south=inv.transform(x-size_m/2,y-size_m/2)
    east,north=inv.transform(x+size_m/2,y+size_m/2)
    return [[south,west],[north,east]]

def ndvi_profile(scene,mask,scl):
    good=mask & np.isin(scl,[4,5]) & np.isfinite(scene["nir"]) & np.isfinite(scene["red"])
    good &= (scene["nir"]>0) & (scene["red"]>0)
    if int(good.sum())<20:
        return None
    index=(scene["nir"]-scene["red"])/(scene["nir"]+scene["red"]+1e-6)
    return round(float(np.median(index[good])),3)
