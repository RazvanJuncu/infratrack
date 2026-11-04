"""One-time OSM route discovery; prints candidate highway geometry for human validation."""
import requests,json, math
ql='''[out:json][timeout:90];
(
 way["ref"~"(^|;)A0(;|$)"](44.42,26.12,44.60,26.41);
 way["highway"="construction"]["construction"="motorway"](44.42,26.12,44.60,26.41);
 way["name"~"A0|Autostrada.*centur",i](44.42,26.12,44.60,26.41);
);
out geom;'''
endpoints=["https://overpass.kumi.systems/api/interpreter","https://overpass-api.de/api/interpreter","https://overpass.nchc.org.tw/api/interpreter"]
for url in endpoints:
    try:
        r=requests.post(url,data={"data":ql},headers={"User-Agent":"InfraTrack Research Alpha https://github.com/RazvanJuncu/infratrack"},timeout=120)
        print("status",url,r.status_code,r.text[:150])
        r.raise_for_status()
        data=r.json()
        elements=data.get("elements",[])
        print("ELEMENTS",len(elements))
        for v in elements[:120]:
            coords=v.get("geometry") or []
            l=0
            for a,b in zip(coords,coords[1:]):
                l+=math.hypot((a["lat"]-b["lat"])*111000,(a["lon"]-b["lon"])*78000)
            c=coords[len(coords)//2] if coords else {}
            print(v["id"],f"{l/1000:.2f} km",v.get("tags",{}),{"mid":c,"first":coords[0] if coords else {},"last":coords[-1] if coords else {}})
        break
    except Exception as e:
        print("FAILED",url,str(e)[:400])
