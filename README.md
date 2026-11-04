# 🛰️ InfraTrack · Earth Observation Alpha

A real-data satellite change-detection experiment for tracking large infrastructure works, starting with a **provisional 2 × 2 km study area** near the A0 Nord Afumați–Pantelimon corridor.

**Live site (after deployment):** https://razvanjuncu.github.io/infratrack/

## What this alpha actually does
- GitHub Actions downloads **real** Sentinel-2 Level-2A images from [Element 84 Earth Search](https://earth-search.aws.element84.com/v1), not generated samples.
- It searches for one sufficiently clear image from summer 2023 and another from summer 2025.
- It masks clouds using Sentinel-2 SCL and highlights candidate areas with substantial vegetation loss and increased reflectance.
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
