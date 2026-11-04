"""Import source-backed annotations from GitHub issues, OWNER ONLY.
Expected issue.body contains a fenced block named infratrack-label with JSON.
Evidence quality is owner-attested, not independently audited.
"""
import json
import os
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ALLOWED={"construction","agriculture","unchanged"}
PATTERN=re.compile(r"(?s)"+("\x60"*3)+r"infratrack-label\s*\n(\{.*?\})\s*\n"+("\x60"*3))
OWNER="RazvanJuncu"

def parse_issue(event):
    issue=event.get("issue",{})
    author=(issue.get("user") or {}).get("login","")
    if author.lower()!=OWNER.lower():
        raise ValueError("Only repository owner annotations are accepted")
    if not issue.get("title","").startswith("[InfraTrack label]"):
        raise ValueError("Not an InfraTrack annotation issue")
    match=PATTERN.search(issue.get("body") or "")
    if not match:
        raise ValueError("Missing infratrack-label JSON block")
    return json.loads(match.group(1)),issue,author

def validate(data,issue,author):
    required=("study_id","signature","row","col","label","site_group",
              "evidence_url","evidence_date","note","attestation")
    if any(k not in data for k in required):
        raise ValueError("Missing required annotation fields")
    registry=Path("projects/regions.json")
    site_ids={"a0-nord3-2km-v05"}  # Legacy first AOI
    if registry.exists():
        configuration=json.loads(registry.read_text(encoding="utf-8"))
        for site in configuration.get("sites",[]):
            if site.get("use_anchor"):
                continue
            site_ids.add(site["id"]+"-2km-v1")
    if data["study_id"] not in site_ids:
        raise ValueError("Unexpected or unregistered study identifier")
    if not re.fullmatch(r"[a-f0-9]{16}",str(data["signature"])):
        raise ValueError("Invalid scene signature")
    if type(data["row"]) is not int or type(data["col"]) is not int:
        raise ValueError("Pixel coordinates must be integers")
    if not (0<=data["row"]<200 and 0<=data["col"]<200):
        raise ValueError("Outside the experimental 200x200 image")
    if data["label"] not in ALLOWED:
        raise ValueError("Unknown annotation class")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{4,64}",str(data["site_group"])):
        raise ValueError("Site group must use 4-64 letters, digits, - or _")
    url=str(data["evidence_url"])
    parsed=urlparse(url)
    if parsed.scheme not in ("https","http") or not parsed.netloc or len(url)>900:
        raise ValueError("Evidence must be a public HTTP(S) link")
    try:
        day=date.fromisoformat(str(data["evidence_date"]))
    except ValueError as e:
        raise ValueError("Invalid evidence date") from e
    if not(date(2015,1,1)<=day<=date.today()):
        raise ValueError("Evidence date cannot be in the future")
    note=str(data["note"])
    if len(note)<12 or len(note)>1200:
        raise ValueError("Describe independent evidence (12-1200 chars)")
    if data["attestation"] is not True:
        raise ValueError("Owner must attest to checking the evidence")
    return {
        "issue_number":int(issue["number"]),
        "issue_url":str(issue.get("html_url","")),
        "study_id":data["study_id"],"signature":data["signature"],
        "row":data["row"],"col":data["col"],"label":data["label"],
        "site_group":data["site_group"],
        "evidence_url":url,"evidence_date":day.isoformat(),
        "note":note,"reviewed_by":author,
        "review_status":"owner_attested_not_independently_audited",
    }

def main():
    event=json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    data,issue,author=parse_issue(event)
    row=validate(data,issue,author)
    output=Path("labels/reviewed.jsonl")
    output.parent.mkdir(parents=True,exist_ok=True)
    existing=[]
    if output.exists():
        existing=[json.loads(line) for line in output.read_text(encoding="utf-8").splitlines() if line.strip()]
    existing=[entry for entry in existing if entry.get("issue_number")!=row["issue_number"]]
    existing.append(row)
    existing.sort(key=lambda r:r["issue_number"])
    output.write_text("".join(json.dumps(entry,ensure_ascii=False,sort_keys=True)+"\n"
                              for entry in existing),encoding="utf-8")
    print(f"Stored owner-attested annotation {row['issue_number']} as {row['label']} at pixel ({row['row']},{row['col']})")
    print("Evidence quality is not independently audited.")

if __name__=="__main__":
    main()
