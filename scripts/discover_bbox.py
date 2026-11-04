"""Discover MOTORWAY geometries with small official OSM API bbox requests, no Overpass."""
import requests,math
from xml.etree import ElementTree as ET
AREAS=[
 ("A0 South Bragadiru near DN6",25.951,44.346,25.982,44.363,"A0",44.354,25.967),
 ("A1 Tigveni area",24.588,45.125,24.616,45.147,"A1",45.135,24.6),
 ("A7 southern Ramnicu Sarat",27.082,45.361,27.106,45.381,"A7",45.370,27.094),
]
for label,w,s,e,n,ref,lat,lon in AREAS:
 try:
    url=f"https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
    resp=requests.get(url,timeout=45,headers={"User-Agent":"InfraTrack research contact github RazvanJuncu/infratrack"})
    resp.raise_for_status()
    root=ET.fromstring(resp.content)
    nodes={v.attrib["id"]:(float(v.attrib["lat"]),float(v.attrib["lon"])) for v in root.findall("node")}
    roads=[]
    for way in root.findall("way"):
       tags={x.attrib["k"]:x.attrib["v"] for x in way.findall("tag")}
       if ref not in tags.get("ref","").split(";") or tags.get("highway") not in ("motorway","construction"):continue
       pts=[nodes[x.attrib["ref"]] for x in way.findall("nd") if x.attrib["ref"] in nodes]
       if len(pts)<2:continue
       m=pts[len(pts)//2]
       dist=math.hypot((m[0]-lat)*111,(m[1]-lon)*78)
       roads.append((dist,way.attrib["id"],m,tags))
    roads.sort()
    print("AREA",label,"roads",len(roads),flush=True)
    for dist,way,m,tags in roads[:12]:
       print("ROAD",round(dist,3),way,round(m[0],6),round(m[1],6),tags.get("name"),tags.get("highway"),flush=True)
 except Exception as e:print("ERROR",label,str(e)[:300],flush=True)
