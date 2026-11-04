"""Publish an honest error rather than fake satellite imagery."""
from pathlib import Path
import json
p=Path("site")
p.mkdir(parents=True, exist_ok=True)
(p/"data.json").write_text(json.dumps({
 "status":"unavailable",
 "message":"Real Sentinel-2 imagery could not be retrieved or processed. Inspect the GitHub Actions workflow logs. No detection was produced."
},indent=2), encoding="utf-8")
