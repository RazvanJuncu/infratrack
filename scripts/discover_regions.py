"""Discover candidate motorway OSM road geometries for expanding InfraTrack AOIs.
Research tool: candidate geometry only, not confirmed engineering alignment.
"""
import requests
from math import hypot
areas = [
 ("A7 Focsani-Bacau near Adjud",45.990,27.187,0.16,0.25,"A7"),
 ("A7 Buzau-Focsani near Ramnicu Sarat",45.380,27.050,0.20,0.30,"A7"),
 ("A1 Sibiu-Pitesti near Tigveni",45.132,24.601,0.13,0.20,"A1"),
 ("A0 South near Bragadiru",44.357,25.991,0.12,0.18,"A0"),
 ("A0 North near DN2 Afumati",44.507,26.232,0.06,0.06,"A0")
]
for label,lat,lon,latspan,lonspan,ref in areas:
    query=f'[out:json][timeout:25];way["highway"~"motorway|construction"]["ref"~"(^|;){ref}($|;)"]({lat-latspan},{lon-lonspan},{lat+latspan},{lon+lonspan});out geom;'
    done=False
    for endpoint in ("https://overpass.kumi.systems/api/interpreter","https://overpass-api.de/api/interpreter"):
        try:
            r=requests.post(endpoint,data={"data":query},headers={"User-Agent":"InfraTrack research https://github.com/RazvanJuncu/infratrack"},timeout=36)
            r.raise_for_status()
            ways=r.json().get("elements",[])
            filtered=[]
            for w in ways:
                points=w.get("geometry") or []
                if len(points)<2:continue
                c=points[len(points)//2]
                d=hypot((c["lat"]-lat)*111, (c["lon"]-lon)*77)
                filtered.append((d,w,c))
            filtered.sort(key=lambda x:x[0])
            print("AREA",label,"count",len(filtered),"endpoint",endpoint,flush=True)
            for dist,w,p in filtered[:10]:
                print("ROAD",round(dist,2),"km",w["id"],w.get("tags",{}).get("ref"),w.get("tags",{}).get("name"),w.get("tags",{}).get("highway"),"mid",round(p["lat"],6),round(p["lon"],6),flush=True)
            done=True
            break
        except Exception as e:
            print("RETRY",label,str(e)[:130],flush=True)
    if not done:
        print("AREA_UNAVAILABLE",label,flush=True)
