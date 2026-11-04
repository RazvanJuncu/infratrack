"""InfraTrack Validation Lab: sampled, date-specific measurements from REAL Sentinel-2.

The published features contain measurements, not ground-truth labels.
Browser sample measurements are quantized to ~0.008 unit precision.
"""
import base64
import hashlib
import json
from pathlib import Path
import numpy as np
from spectral_v04 import indices, valid_pixels

FEATURE_NAMES=("ndvi","bsi","ndbi")
BANDS=("blue","red","green","nir","swir16")

def make_signature(items):
    ids=[item["id"] for item in items]
    return hashlib.sha256("|".join(ids).encode("utf-8")).hexdigest()[:16]

def create_featurepack(output, transform, observations, worldcover, corridor, source, study_id="a0-nord3-2km-v05"):
    """observations: (item, band_dict, scl) in chronological order.
    
    Important: the 20m SWIR band is resampled to a 10m study grid.
    Derived BSI/NDBI are NOT native 10m measurements.
    """
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    dates=[{"id":item["id"],"date":item["properties"]["datetime"][:10]}
           for item,_,_ in observations]
    signature=make_signature([item for item,_,_ in observations])
    packed={}
    valid_stack=[]
    quantized={}
    for i,(item, bands, scl) in enumerate(observations):
        vals=indices(bands)
        valid=valid_pixels(bands,scl)
        valid_stack.append(valid)
        packed[f"valid_{i}"]=valid.astype(np.uint8)
        for name in FEATURE_NAMES:
            signal=vals[name].astype(np.float32)
            signal[~valid]=np.nan
            packed[f"{name}_{i}"]=signal
            # 255 = invalid; 0..254 represent -1..+1
            quant=np.full(signal.shape,255,dtype=np.uint8)
            quant[valid]=np.rint((np.clip(signal[valid],-1,1)+1)*127).astype(np.uint8)
            quantized[f"{name}_{i}"]=base64.b64encode(quant.tobytes()).decode("ascii")
        quantized[f"valid_{i}"]=base64.b64encode(valid.astype(np.uint8).tobytes()).decode("ascii")
    if len(observations)!=4:
        raise ValueError("Four observation dates are required")
    h,w=worldcover.shape
    if any(bands["red"].shape!=(h,w) for _,bands,_ in observations):
        raise ValueError("Measurements must align to the land-cover raster")
    packed["worldcover"]=worldcover.astype(np.uint8)
    packed["corridor"]=corridor.astype(np.uint8)
    packed["joint_valid"]=np.logical_and.reduce(valid_stack).astype(np.uint8)
    packed["signature"]=np.array(signature)
    packed["study_id"]=np.array(study_id)
    np.savez_compressed(output/"features_v05.npz",**packed)
    source_data={
        "status":"ready","study_id":study_id,"signature":signature,
        "source":"Copernicus Sentinel-2 L2A, four real scenes via Element84",
        "measurements_not_labels":True,
        "resolution_m":10,
        "swir_native_resolution_m":20,
        "dates":dates,
        "width":w,"height":h,
        "grid":{
            "epsg":32635,
            "origin_easting":round(float(transform.c),3),
            "origin_northing":round(float(transform.f),3),
            "pixel_size_m":round(float(transform.a),3)
        },
        "arrays":quantized,
        "worldcover":base64.b64encode(worldcover.astype(np.uint8).tobytes()).decode("ascii"),
        "corridor":base64.b64encode(corridor.astype(np.uint8).tobytes()).decode("ascii"),
        "license_note":"Derived indices from Copernicus Sentinel-2. WorldCover 2021 © ESA WorldCover consortium."
    }
    (output/"inspection_v05.json").write_text(json.dumps(source_data,separators=(",",":")),encoding="utf-8")
    return {k:source_data[k] for k in ("status","study_id","signature","dates","width","height")}
