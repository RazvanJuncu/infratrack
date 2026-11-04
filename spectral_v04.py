"""InfraTrack v0.4 — transparent Sentinel-2 multispectral temporal triage.

No trained construction classifier, and no inferred motorway completion rate.
All thresholds are EXPERIMENTAL and require ground-truth validation.

Bands: blue(B02), red(B04), NIR(B08), SWIR1(B11, resampled 20m -> 10m).
Definitions:
  NDVI = (NIR - RED)/(NIR + RED)
  BSI  = ((SWIR1 + RED) - (NIR + BLUE)) / (SWIR1 + RED + NIR + BLUE)
  NDBI = (SWIR1 - NIR)/(SWIR1 + NIR)
NDBI is not a unique built-up signature: bare soils may appear similar.
"""
import numpy as np
from scipy.ndimage import binary_opening, label

VALID_SCL = [4, 5]  # vegetation and bare ground, excluding cloud/shadow/water
EPS = 1e-6

def indices(bands):
    for key in ("blue", "red", "nir", "swir16"):
        if key not in bands:
            raise ValueError(f"Missing required Sentinel-2 spectral band: {key}")
    nir, red, blue, swir = (bands[k] for k in ("nir", "red", "blue", "swir16"))
    return {
        "ndvi": (nir - red)/(nir + red + EPS),
        "bsi": (swir + red - nir - blue)/(swir + red + nir + blue + EPS),
        "ndbi": (swir - nir)/(swir + nir + EPS)
    }

def valid_pixels(bands, scl):
    valid=np.isin(scl,VALID_SCL)
    for key in ("blue","red","nir","swir16"):
        a=bands[key]
        valid &= np.isfinite(a) & (a > 0) & (a < 1.25)
    return valid

def drop_small(mask, min_pixels=6):
    """Remove isolated speckle. 10m pixels: 6 px = 0.06 ha."""
    opened=binary_opening(mask,structure=np.ones((2,2),dtype=bool))
    labels,count=label(opened)
    if count==0:
        return np.zeros(mask.shape,dtype=bool)
    sizes=np.bincount(labels.ravel())
    sizes[0]=0
    return opened & (sizes[labels] >= min_pixels)

def triage(before, after, spring, follow, scl_before, scl_after,
           scl_spring, scl_follow, corridor, worldcover):
    """Screen real scene stacks for candidate persistence and seasonal recovery.

    Training/labels not inferred. Historical agriculture is context, not exclusion.
    spring and follow are two *different-season 2026* observations.

    Only report on pixels clear in all four scenes. If coverage insufficient,
    caller must report an explicit insufficient-data state.
    """
    shape=before["red"].shape
    if any(x.shape!=shape for x in
           (scl_before,scl_after,scl_spring,scl_follow,corridor,worldcover)):
        raise ValueError("Scenes, classes, and corridor must be coregistered")
    scenes=[before,after,spring,follow]
    masks=[valid_pixels(scene,scl) for scene,scl in
           zip(scenes,[scl_before,scl_after,scl_spring,scl_follow])]
    valid=np.logical_and.reduce(masks)
    if not np.any(valid):
        return {name:np.zeros(shape,dtype=bool) for name in
                ("persistent","regrowth","uncertain","initial_change","valid",
                 "historical_crop","within_corridor")}
    a,b,c,d=[indices(scene) for scene in scenes]
    # Loss of vegetation or transition toward exposed earth.
    initial = valid & (
        ((a["ndvi"] - b["ndvi"]) > .22) |
        (((b["bsi"] - a["bsi"]) > .14) &
         ((a["ndvi"] - b["ndvi"]) > .12))
    )
    initial &= (b["ndvi"] < .37) & (b["bsi"] > -.12)
    # A bare-surface-like spectrum on 2025 summer AND two dates in 2026.
    # These are not construction signatures and can also be farmland.
    persistent=initial & (c["ndvi"] < .34) & (d["ndvi"] < .34)
    persistent &= (c["bsi"] > -.13) & (d["bsi"] > -.13)
    # NDBI is a supplementary signal: not by itself a construction claim.
    persistent &= (b["ndbi"] > -.20) & (d["ndbi"] > -.20)
    # Green returned at at least one of two follow-ups: likely seasonal
    # for 2021 cropland, unresolved elsewhere.
    recovered=initial & ((c["ndvi"] > .42) | (d["ndvi"] > .42))
    seasonal=initial & (worldcover==40) & recovered
    uncertain=initial & ~persistent & ~seasonal
    persistent=drop_small(persistent & corridor)
    seasonal=drop_small(seasonal & corridor)
    uncertain=drop_small(uncertain & corridor)
    # Four-band, four-date valid mask for the study, not all of Earth.
    return {
        "persistent": persistent, "regrowth": seasonal, "uncertain": uncertain,
        "initial_change": initial & corridor, "valid": valid,
        "historical_crop": worldcover==40, "within_corridor": corridor
    }

def render_rgba(result, alpha=205):
    h,w=result["valid"].shape
    image=np.zeros((h,w,4),dtype=np.uint8)
    # ordering: unresolved -> likely seasonal -> persistent
    for name,color in (
        ("uncertain",(223,154,68,alpha)),
        ("regrowth",(106,137,219,alpha)),
        ("persistent",(43,233,188,alpha))
    ):
        image[result[name]]=color
    return image

def report(result, resolution_m=10):
    area=lambda name:round(float(np.count_nonzero(result[name])) * resolution_m**2 / 10000,2)
    corridor=result["within_corridor"]
    total=int(np.count_nonzero(corridor))
    valid=int(np.count_nonzero(corridor & result["valid"]))
    return {
        "analysis":"multispectral_multitemporal_sentinel2_experimental",
        "neural_classifier":False,
        "model_accuracy":None,
        "has_ground_truth":False,
        "counts_as_construction":False,
        "resolution_m":resolution_m,
        "scenes_required":4,
        "corridor_valid_percent":round(100*valid/total,1) if total else 0.,
        "persistent_bare_candidate_ha":area("persistent"),
        "likely_seasonal_cropland_ha":area("regrowth"),
        "unresolved_change_ha":area("uncertain"),
        "initial_change_ha":area("initial_change"),
        "note":"All classes are unvalidated spectral hypotheses; persistent bare fields and construction may be confused. Only clear pixels on 4 dates are considered."
    }
