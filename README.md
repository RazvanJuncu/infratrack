# 🛰️ InfraTrack · Earth Observation Alpha

A real-data satellite change-detection experiment for tracking large infrastructure works, starting with a **provisional 2 × 2 km study area** near the A0 Nord Afumați–Pantelimon corridor.

**Live site (after deployment):** https://razvanjuncu.github.io/infratrack/

## What this alpha actually does
- GitHub Actions downloads **real** Sentinel-2 Level-2A images from [Element 84 Earth Search](https://earth-search.aws.element84.com/v1), not generated samples.
- It searches for one sufficiently clear image from summer 2023, another from summer 2025, plus a summer-2026 follow-up.
- It masks clouds using Sentinel-2 SCL and highlights candidate areas with substantial vegetation loss and increased reflectance.
- It also reads the **ESA WorldCover 2021 machine-learning land-cover map** and independently checks a later Sentinel-2 observation from summer 2026.
- Candidate changes are shown as historical cropland context, persistent low-vegetation change on non-cropland, or unresolved review. **No category proves infrastructure construction.**
- There is NO hosted LLM, NO per-inference AI API charge, and NO new neural-network inference inside the pipeline at this stage. The land-cover baseline comes from an existing trained ML map; the interpretative rules are explicit and testable.
- It publishes a before/after slider and dated image scene IDs to GitHub Pages.

The current detector **does not establish** that changes are roadworks, does not cover the whole 8.6 km lot, and **cannot** calculate construction completion. Crop harvests, shadows, dates and seasonal changes can lead to false positives. The 2 km sample-area location is provisional and must be validated against the actual road alignment.

## Development model — no local servers
1. Changes to `main` automatically run the [GitHub Actions workflow](https://github.com/RazvanJuncu/infratrack/actions/workflows/pages.yml).
2. The workflow performs Python unit tests, queries real satellite imagery, then publishes a static site.
3. You open the resulting [InfraTrack site](https://razvanjuncu.github.io/infratrack/). You don't start anything locally.
4. To re-run manually use **Actions → InfraTrack — real Sentinel-2 to GitHub Pages → Run workflow**.

If GitHub Pages is not yet enabled, use **Settings → Pages → Build and deployment → Source: GitHub Actions** once.

## Provenance and error handling
- Source: Copernicus Sentinel-2, via Element 84 STAC and public Cloud Optimized GeoTIFFs.
- The page displays **NO VERIFIED OBSERVATION** if data cannot be retrieved.
- Synthetic arrays are used strictly in `tests/` to check deterministic math — never in public imagery.
- Real scene identifiers, dates and the processed area appear in `site/data.json` once a run succeeds. Runtime output is deployed as a Pages artifact, not committed back to GitHub.

## Stack
Python · Rasterio · NumPy · SciPy · PyProj · Pillow · GitHub Actions · GitHub Pages · vanilla HTML/CSS/JS.

**Cost model:** no paid provider or server is required for the initial GitHub Free public-repository experiment; subject to GitHub Actions/Pages usage limits and availability of public imagery services.

## Next experiments
1. Confirm the true study-area geometry relative to the motorway.
2. Verify scene provenance and compare detections with independently dated construction photos.
3. Reduce false positives using multi-date baseline and agricultural masks.
4. Add a project watchlist only after measured reliability has been demonstrated.

## ML context & limitations (v0.2)

The ESA WorldCover 2021 land-cover baseline is freely available under CC BY 4.0. It was produced by an external ML classification process with non-perfect classification accuracy. The baseline is **historical**: land mapped as cropland in 2021 may have become an actual motorway by 2025, so those changes are shown for manual review rather than excluded outright.

The 2026 follow-up is evidence of persistence only, not an infrastructure classifier. Low vegetation in two summer seasons can also occur in agriculture. No numerical model confidence, roadwork percentage or authoritative progress is generated. ESA WorldCover attribution: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.

An optional, separately validated CPU/ONNX earth-observation model may be added after measuring false positives on ground-truthed examples. Generic image-caption models are not appropriate proof of construction at Sentinel-2's 10 m pixel size.
