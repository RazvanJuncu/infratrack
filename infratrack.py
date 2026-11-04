#!/usr/bin/env python3
"""Real Sentinel-2 change candidates. Never infers construction completion."""
import argparse
import io
import json
from pathlib import Path
import requests
import numpy as np
from PIL import Image
from scipy.ndimage import binary_opening, binary_closing, label
from pyproj import Transformer
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from corridor_osm import fetch_route, corridor_raster, aoi_bounds, ndvi_profile
from spectral_v04 import triage as spectral_triage, render_rgba, report as spectral_report
from feature_v05 import create_featurepack

STAC = "https://earth-search.aws.element84.com/v1/search"
COLLECTION = "sentinel-2-c1-l2a"

def vegetation_candidates(before, after, scl_before, scl_after):
    """Only identifies spectral vegetation-to-exposed-surface *candidates*."""
    valid = np.isin(scl_before, [4, 5]) & np.isin(scl_after, [4, 5])
    for scene in (before, after):
        for name in ("red", "green", "blue", "nir"):
            valid &= np.isfinite(scene[name]) & (scene[name] > 0)
    eps = 1e-6
    ndvi0 = (before["nir"] - before["red"]) / (before["nir"] + before["red"] + eps)
    ndvi1 = (after["nir"] - after["red"]) / (after["nir"] + after["red"] + eps)
    vis0 = (before["red"] + before["green"] + before["blue"]) / 3
    vis1 = (after["red"] + after["green"] + after["blue"]) / 3
    mask = valid & (ndvi0 > .35) & ((ndvi0 - ndvi1) > .25) & (ndvi1 < .35)
    mask &= (vis1 - vis0) > .02
    mask = binary_opening(mask, structure=np.ones((2, 2), dtype=bool))
    mask = binary_closing(mask, structure=np.ones((2, 2), dtype=bool))
    objects, n = label(mask)
    if n:
        counts = np.bincount(objects.ravel())
        counts[0] = 0
        mask = (objects != 0) & (counts[objects] >= 14)
    return mask, valid

def search_scenes(lat, lon, size_m, date_range, cloud_limit):
    project = Transformer.from_crs("EPSG:4326", "EPSG:32635", always_xy=True)
    inverse = Transformer.from_crs("EPSG:32635", "EPSG:4326", always_xy=True)
    x, y = project.transform(lon, lat)
    half = size_m / 2
    west, south = inverse.transform(x - half, y - half)
    east, north = inverse.transform(x + half, y + half)
    start, end = date_range.split("/")
    # STAC Search requires RFC3339 timestamps (not plain YYYY-MM-DD intervals).
    when = f"{start}T00:00:00Z/{end}T23:59:59Z"
    body = {"collections": [COLLECTION], "bbox": [west, south, east, north],
            "datetime": when, "limit": 100}
    resp = requests.post(STAC, json=body, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"STAC HTTP {resp.status_code}: {resp.text[:900]} | query={body}")
    found = [i for i in resp.json().get("features", [])
             if i.get("properties", {}).get("eo:cloud_cover", 100) <= cloud_limit]
    return sorted(found, key=lambda i: i["properties"].get("eo:cloud_cover", 100))

def read_band(item, name, transform, pixels, nearest=False):
    asset = item["assets"][name]
    url = asset["href"]
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        GDAL_HTTP_MAX_RETRY="3",
        GDAL_HTTP_RETRY_DELAY="1",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff"
    ):
        with rasterio.open(url) as source:
            with WarpedVRT(source, crs="EPSG:32635", transform=transform,
                           width=pixels, height=pixels,
                           resampling=Resampling.nearest if nearest else Resampling.bilinear) as raster:
                raw = raster.read(1)
    if nearest:
        return raw.astype(np.uint8)
    metadata = (asset.get("raster:bands") or [{}])[0]
    scale = float(metadata.get("scale", .0001))
    offset = float(metadata.get("offset", 0))
    values = raw.astype(np.float32) * scale + offset
    values[raw == 0] = np.nan
    return values

def select_scene(lat, lon, size_m, pixels, period, cloud_limit, transform):
    scenes = search_scenes(lat, lon, size_m, period, cloud_limit)
    if not scenes:
        raise RuntimeError(f"No Sentinel-2 scenes matching cloud limit for {period}")
    errors = []
    for item in scenes[:8]:
        try:
            keys = ("red", "green", "blue", "nir", "swir16", "scl")
            if any(k not in item.get("assets", {}) for k in keys):
                continue
            bands = {k: read_band(item, k, transform, pixels) for k in keys[:-1]}
            scl = read_band(item, "scl", transform, pixels, nearest=True)
            clear = np.isin(scl, [4, 5, 6])
            if clear.mean() < .60:
                errors.append(f"{item['id']} locally clear {clear.mean():.0%}")
                continue
            return item, bands, scl
        except Exception as exc:
            errors.append(f"{item['id']}: {str(exc)[:120]}")
    raise RuntimeError("No usable locally clear imagery. " + " | ".join(errors))

def rgb_image(scene):
    img = np.stack([scene["red"], scene["green"], scene["blue"]], axis=-1)
    return (255 * np.power(np.clip((img - .012) / .33, 0, 1), .85)).astype(np.uint8)


def worldcover_tile(lat, lon):
    """ESA WorldCover 3° tile anchored at its south-west corner."""
    from math import floor
    row = int(floor(lat / 3.0) * 3)
    col = int(floor(lon / 3.0) * 3)
    return f"{'N' if row >= 0 else 'S'}{abs(row):02d}{'E' if col >= 0 else 'W'}{abs(col):03d}"


def read_worldcover(lat, lon, transform, pixels):
    """Read precomputed ML-based 2021 ESA WorldCover land-use labels from a public COG."""
    tile = worldcover_tile(lat, lon)
    url = ("https://esa-worldcover.s3.amazonaws.com/v200/2021/map/"
           f"ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                       GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1"):
        with rasterio.open(url) as source:
            with WarpedVRT(source, crs="EPSG:32635", transform=transform,
                           width=pixels, height=pixels,
                           resampling=Resampling.nearest) as layer:
                array = layer.read(1).astype(np.uint8)
    if not np.any(array):
        raise RuntimeError("WorldCover returned no land-cover classes")
    return array, url


def interpret_landcover(raw, valid, worldcover, later, later_scl):
    """Conservative triage, NOT a construction AI model.
    
    Land-cover labels are provided by a pretrained ESA classification product.
    A pre-existing cropland label does not *rule out* a later highway construction:
    those pixels remain visible for manual review. A non-cropland, persistent
    bare/low-vegetation signature is a candidate, not a confirmed worksite.
    """
    shape = raw.shape
    if worldcover.shape != shape or later_scl.shape != shape:
        raise ValueError("Classification rasters must align")
    good = valid & np.isin(later_scl, [4, 5])
    for b in ("nir", "red"):
        good &= np.isfinite(later[b]) & (later[b] > 0)
    ndvi = (later["nir"] - later["red"]) / (later["nir"] + later["red"] + 1e-6)
    persistent = raw & good & (ndvi < .35)
    agriculture = raw & (worldcover == 40)
    review = raw & (worldcover != 40) & ~persistent
    noncrop_persistent = persistent & (worldcover != 40)
    unknown = raw & (worldcover == 0)
    return {"agricultural_context": agriculture & ~unknown,
            "persistent_noncrop": noncrop_persistent & ~unknown,
            "manual_review": review | unknown, "later_valid": good}


def layered_preview(base_image, classification):
    image = base_image.copy()
    colors = [
        ("agricultural_context", [239, 169, 67]),   # amber
        ("manual_review", [224, 88, 108]),          # red
        ("persistent_noncrop", [64, 218, 192])      # cyan
    ]
    for name, color in colors:
        chosen = classification[name]
        image[chosen] = (.35 * image[chosen] + .65 * np.array(color)).astype(np.uint8)
    return image

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, default=44.5065)
    parser.add_argument("--lon", type=float, default=26.2328)
    parser.add_argument("--size-km", type=float, default=2)
    parser.add_argument("--before", default="2023-06-01/2023-08-31")
    parser.add_argument("--after", default="2025-06-01/2025-08-31")
    parser.add_argument("--max-cloud", type=float, default=35)
    parser.add_argument("--output", default="site")
    parser.add_argument("--followup", default="2026-08-01/2026-09-30")
    args = parser.parse_args()
    assert .2 <= args.size_km <= 5, "MVP AOI must be 0.2-5 km"
    metres = 1000 * args.size_km
    resolution = 10
    pixels = int(round(metres / resolution))
    t = Transformer.from_crs("EPSG:4326", "EPSG:32635", always_xy=True)
    x, y = t.transform(args.lon, args.lat)
    transform = from_origin(x - metres / 2, y + metres / 2, resolution, resolution)
    print("Fetching OSM-mapped A0 Nord Lot 3 corridor geometry...",flush=True)
    route, route_source = fetch_route()
    corridor = corridor_raster(route,transform,pixels)
    if not corridor.any():
        print("WARNING: No A0 mapped way intersects the study AOI; NOT assessing infrastructure changes",flush=True)
    else:
        print(f"OSM road-buffer study coverage: {corridor.sum()*resolution*resolution/10000:.2f} ha",flush=True)
    print("Searching real Sentinel-2 STAC scenes...", flush=True)
    a, before, scl0 = select_scene(args.lat, args.lon, metres, pixels, args.before, args.max_cloud, transform)
    b, after, scl1 = select_scene(args.lat, args.lon, metres, pixels, args.after, args.max_cloud, transform)
    mask, clear = vegetation_candidates(before, after, scl0, scl1)
    print("Loading ESA WorldCover 2021 ML land-cover map and 2026 follow-up...", flush=True)
    worldcover, wc_url = read_worldcover(args.lat, args.lon, transform, pixels)
    c, followup, scl2 = select_scene(args.lat, args.lon, metres, pixels, args.followup,
                                     args.max_cloud, transform)
    corridor_change = mask & corridor
    analysis = interpret_landcover(corridor_change, clear, worldcover, followup, scl2)
    # Experimental four-date multispectral triage; absence of imagery is explicit.
    print("v0.4: reading additional 2026 spring scene and SWIR bands...",flush=True)
    spectral=None
    spring_scene=None
    spectral_error=None
    try:
        spring_scene,spring_bands,spring_scl=select_scene(
            args.lat,args.lon,metres,pixels,"2026-04-01/2026-06-30",
            args.max_cloud,transform)
        spectral=spectral_triage(before,after,spring_bands,followup,
                                scl0,scl1,spring_scl,scl2,corridor,worldcover)
    except Exception as err:
        spectral_error=str(err)[:350]
        print(f"v0.4 multispectral inference unavailable: {spectral_error}",flush=True)
    # A five-year same-season profile, with missing observations recorded explicitly.
    series=[]
    for year in (2022,2023,2024,2025,2026):
        if year == 2023:
            item, bands, scl = a, before, scl0
        elif year == 2025:
            item, bands, scl = b, after, scl1
        elif year == 2026:
            item, bands, scl = c, followup, scl2
        else:
            try:
                period=f"{year}-06-01/{year}-09-30"
                item,bands,scl=select_scene(args.lat,args.lon,metres,pixels,period,
                                             args.max_cloud,transform)
            except Exception as error:
                print(f"Temporal observation unavailable for {year}: {error}",flush=True)
                series.append({"year":year,"date":None,"corridor_ndvi":None,
                               "control_ndvi":None,"scene_id":None})
                continue
        if corridor.any():
            on=ndvi_profile(bands,corridor,scl)
            off=ndvi_profile(bands,~corridor,scl)
        else:
            on,off=None,None
        series.append({"year":year,"date":item["properties"]["datetime"][:10],
                       "corridor_ndvi":on,"control_ndvi":off,"scene_id":item["id"]})

    if clear.mean() < .45:
        raise RuntimeError(f"Only {clear.mean():.1%} pixels clear in BOTH scenes, unusable comparison")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    img0, img1 = rgb_image(before), rgb_image(after)
    marked = img1.copy()
    marked[mask] = (.40 * marked[mask] + .60 * np.array([255, 68, 87])).astype(np.uint8)
    interpreted = layered_preview(img1, analysis)
    outlined=img1.copy()
    outlined[corridor_change] = (.30 * outlined[corridor_change] + .70 * np.array([47,224,192])).astype(np.uint8)
    overlay=np.zeros((pixels,pixels,4),dtype=np.uint8)
    overlay[corridor_change]=np.array([50,234,205,204],dtype=np.uint8)
    Image.fromarray(overlay,"RGBA").save(output/"corridor_changes.png",optimize=True)
    (output/"corridor.geojson").write_text(json.dumps(route,ensure_ascii=False),encoding="utf-8")
    # Validation Lab never invents classes: these are raw measurements from
    # already retrieved real scenes, with scene-bound provenance signatures.
    v05={"status":"unavailable","message":"Four real observations not available"}
    if spectral is not None and spring_scene is not None:
        try:
            v05=create_featurepack(
                output,transform,
                [(a,before,scl0),(b,after,scl1),
                 (spring_scene,spring_bands,spring_scl),(c,followup,scl2)],
                worldcover,corridor,route_source)
        except Exception as exc:
            v05={"status":"unavailable","message":str(exc)[:200]}
            print(f"Validation featurepack unavailable: {exc}",flush=True)
    if spectral is not None:
        colors=render_rgba(spectral)
        Image.fromarray(colors,"RGBA").save(
            output/"spectral_candidates.png",optimize=True)
        alpha=colors[:,:,3:4].astype(np.float32)/255
        preview=(img1.astype(np.float32)*(1-alpha) +
                 colors[:,:,:3].astype(np.float32)*alpha).astype(np.uint8)
        Image.fromarray(preview,"RGB").save(
            output/"spectral_preview.png",optimize=True)
    for name, image in [("before.png", img0), ("after.png", img1),
                        ("candidates.png", marked), ("interpreted.png", interpreted),
                        ("corridor_preview.png",outlined)]:
        Image.fromarray(image, "RGB").save(output / name, optimize=True)
    result = {
        "status": "ready",
        "mode": "REAL_SENTINEL_2",
        "title": "A0 Nord · Afumați–Pantelimon",
        "warning": "Spectral-change candidates; NOT validated construction, earthworks, or project completion.",
        "area_note": "2 km study window centered on OSM-mapped A0 Lot 3. Mapped route is not an authoritative construction survey. Entire 8.6 km lot is NOT analyzed.",
        "site": {"lat": args.lat, "lon": args.lon, "size_km": args.size_km,
                 "bounds": aoi_bounds(args.lon,args.lat,metres)},
        "corridor": {"status":"mapped_osm" if corridor.any() else "unavailable",
                     "source":route_source,"buffer_m":130,
                     "mapped_way_count":len(route["features"]),
                     "study_hectares":round(float(corridor.sum())/100,2),
                     "candidate_hectares":round(float(corridor_change.sum())/100,2),
                     "confidence":"Mapped OSM alignment, not independently verified survey"},
        "temporal": series,
        "v05":v05,
        "v04": (
            dict({"status":"ready",
                  "spring_scene":{"date":spring_scene["properties"]["datetime"][:10],
                                  "id":spring_scene["id"]}},
                 **spectral_report(spectral))
            if spectral is not None else
            {"status":"unavailable","reason":spectral_error or "Additional Sentinel image unavailable",
             "counts_as_construction":False, "neural_classifier":False}),
        
        "before": {"date": a["properties"]["datetime"][:10], "id": a["id"],
                   "cloud_percent_scene": a["properties"].get("eo:cloud_cover")},
        "after": {"date": b["properties"]["datetime"][:10], "id": b["id"],
                  "cloud_percent_scene": b["properties"].get("eo:cloud_cover")},
        "clear_overlap_percent": round(100 * float(clear.mean()), 1),
        "candidate_hectares": round(float(mask.sum()) * resolution * resolution / 10000, 2),
        "candidate_pixels": int(mask.sum()), "pixel_size_m": resolution,
        "interpretation": {
            "method": "ESA WorldCover 2021 ML land-cover map + independent 2026 Sentinel-2 observation + transparent rule-based triage",
            "local_neural_network": False,
            "note": "These are hypotheses, not confirmed agriculture or infrastructure. The 2021 crop mask may include roads built later.",
            "followup": {"date": c["properties"]["datetime"][:10], "id": c["id"]},
            "worldcover_tile": worldcover_tile(args.lat, args.lon),
            "worldcover_url": wc_url,
            "agricultural_context_hectares": round(float(analysis["agricultural_context"].sum()) / 100, 2),
            "persistent_noncrop_hectares": round(float(analysis["persistent_noncrop"].sum()) / 100, 2),
            "manual_review_hectares": round(float(analysis["manual_review"].sum()) / 100, 2)
        },
        "source": "Element 84 Earth Search · Copernicus Sentinel-2 Level-2A",
        "source_api": "https://earth-search.aws.element84.com/v1",
        "images": ["before.png", "after.png", "candidates.png", "interpreted.png",
                   "corridor_preview.png","corridor_changes.png"] +
                  (["spectral_candidates.png","spectral_preview.png"] if spectral is not None else [])
    }
    (output / "data.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)

if __name__ == "__main__":
    main()
