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
    body = {"collections": [COLLECTION], "bbox": [west, south, east, north],
            "datetime": date_range, "limit": 100}
    resp = requests.post(STAC, json=body, timeout=60)
    resp.raise_for_status()
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
            keys = ("red", "green", "blue", "nir", "scl")
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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, default=44.5128)
    parser.add_argument("--lon", type=float, default=26.2795)
    parser.add_argument("--size-km", type=float, default=2)
    parser.add_argument("--before", default="2023-06-01/2023-08-31")
    parser.add_argument("--after", default="2025-06-01/2025-08-31")
    parser.add_argument("--max-cloud", type=float, default=35)
    parser.add_argument("--output", default="site")
    args = parser.parse_args()
    assert .2 <= args.size_km <= 5, "MVP AOI must be 0.2-5 km"
    metres = 1000 * args.size_km
    resolution = 10
    pixels = int(round(metres / resolution))
    t = Transformer.from_crs("EPSG:4326", "EPSG:32635", always_xy=True)
    x, y = t.transform(args.lon, args.lat)
    transform = from_origin(x - metres / 2, y + metres / 2, resolution, resolution)
    print("Searching real Sentinel-2 STAC scenes...", flush=True)
    a, before, scl0 = select_scene(args.lat, args.lon, metres, pixels, args.before, args.max_cloud, transform)
    b, after, scl1 = select_scene(args.lat, args.lon, metres, pixels, args.after, args.max_cloud, transform)
    mask, clear = vegetation_candidates(before, after, scl0, scl1)
    if clear.mean() < .45:
        raise RuntimeError(f"Only {clear.mean():.1%} pixels clear in BOTH scenes, unusable comparison")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    img0, img1 = rgb_image(before), rgb_image(after)
    marked = img1.copy()
    marked[mask] = (.40 * marked[mask] + .60 * np.array([255, 68, 87])).astype(np.uint8)
    for name, image in [("before.png", img0), ("after.png", img1), ("candidates.png", marked)]:
        Image.fromarray(image, "RGB").save(output / name, optimize=True)
    result = {
        "status": "ready",
        "mode": "REAL_SENTINEL_2",
        "title": "A0 Nord · Afumați–Pantelimon",
        "warning": "Spectral-change candidates; NOT validated construction, earthworks, or project completion.",
        "area_note": "Provisional 2 km research AOI; alignment with exact A0 corridor not yet confirmed.",
        "site": {"lat": args.lat, "lon": args.lon, "size_km": args.size_km},
        "before": {"date": a["properties"]["datetime"][:10], "id": a["id"],
                   "cloud_percent_scene": a["properties"].get("eo:cloud_cover")},
        "after": {"date": b["properties"]["datetime"][:10], "id": b["id"],
                  "cloud_percent_scene": b["properties"].get("eo:cloud_cover")},
        "clear_overlap_percent": round(100 * float(clear.mean()), 1),
        "candidate_hectares": round(float(mask.sum()) * resolution * resolution / 10000, 2),
        "candidate_pixels": int(mask.sum()), "pixel_size_m": resolution,
        "source": "Element 84 Earth Search · Copernicus Sentinel-2 Level-2A",
        "source_api": "https://earth-search.aws.element84.com/v1",
        "images": ["before.png", "after.png", "candidates.png"]
    }
    (output / "data.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)

if __name__ == "__main__":
    main()
