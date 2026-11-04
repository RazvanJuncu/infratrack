# 🛰️ InfraTrack · Earth Observation Alpha

## Current product layout

- **[Explore](https://razvanjuncu.github.io/infratrack/)** — minimal location selector, original Sentinel-2 before/after images, optional map. No spectral chart or labeling form on the main page.
- **[Training](https://razvanjuncu.github.io/infratrack/training.html)** — separate, simple four-button review for the selected site. Previous/Next/Undo and local-only provisional drafts; *Verify* reveals evidence fields only when deliberately requested.
- **[Technical](https://razvanjuncu.github.io/infratrack/technical.html)** — preserved long-form research prototype, NDVI timelines and screening diagnostics for the original A0 anchor study.

## Multi-area portfolio (v0.7)

`projects/regions.json` now declares **five independently centered 2 × 2 km study windows** on OSM-mapped motorway ways:

1. A0 Nord lot 3 near DN2 (original anchor);
2. A0 Sud Bragadiru/DN6;
3. A7 near Râmnicu Sărat (south);
4. A7 near Râmnicu Sărat (north; separate observation window);
5. A1 Tigveni–Curtea de Argeș (selected OSM motorway way).

GitHub Actions attempts to process **four real Sentinel scenes per window**: summer 2023, summer 2025, spring 2026, summer 2026. Each window has distinct images, date/source IDs, spectra, review queue, and independent `features_v05.npz`. No AI-generated imagery. If remote satellite/OSM sources fail for a window, its status in `site/projects.json` is **unavailable**, not a fictional demonstration. These are only small samples around mapped roadways, NOT coverage of full motorway projects or Romania. Four additional areas are first-stage sampling; the architecture supports adding more registry entries. Repeated observations can incur GitHub Actions resource costs/limits even without a paid AI API.

Do not infer percentage complete or classify all spectral changes as construction. The candidate queue is unverified; rapid clicks stay local to the browser and do not train a model. The model is still blocked on independently sourced ground-truth labels and geographically separated evaluation. 10 m multispectral pixels cannot distinguish every kind of civil engineering work.


A real-data satellite change-detection experiment for infrastructure, now centered on a **2 km × 2 km study window intersecting mapped A0 Nord Lot 3 roadways**, not an arbitrary field.

**Live site (after deployment):** https://razvanjuncu.github.io/infratrack/

## What this alpha actually does
- GitHub Actions downloads **real** Sentinel-2 Level-2A images from [Element 84 Earth Search](https://earth-search.aws.element84.com/v1), not generated samples.
- It searches for real satellite observations from 2022, 2023, 2024, 2025, and 2026, recording any unavailable dates.
- It masks clouds using Sentinel-2 SCL and highlights candidate areas with substantial vegetation loss and increased reflectance.
- It also reads the **ESA WorldCover 2021 machine-learning land-cover map** and independently checks a later Sentinel-2 observation from summer 2026.
- Candidate changes are shown as historical cropland context, persistent low-vegetation change on non-cropland, or unresolved review. **No category proves infrastructure construction.**
- There is NO hosted LLM, NO per-inference AI API charge, and NO new neural-network inference inside the pipeline at this stage. The land-cover baseline comes from an existing trained ML map; the interpretative rules are explicit and testable.
- It downloads a bounded set of mapped A0 Lot 3 highway ways from OpenStreetMap, marks a 130 m proximity buffer, and calculates *separate* candidate change inside versus outside it.
- It publishes a Leaflet map (OSM geometry, study rectangle, opt-in candidate overlay), a five-year NDVI profile, a before/after slider, and sourced scene IDs to GitHub Pages.

The current detector **does not establish** that changes are roadworks, does not cover the whole 8.6 km lot, and **cannot** calculate construction completion. Crop harvests, shadows and seasonal differences cause false positives. The corridor is drawn from explicitly identified OSM ways; those positions are not a verified engineering as-built or statutory construction boundary.

## Development model — no local servers
1. Changes to `main` automatically run the [GitHub Actions workflow](https://github.com/RazvanJuncu/infratrack/actions/workflows/pages.yml).
2. The workflow performs Python unit tests, queries real satellite imagery, then publishes a static site.
3. You open the resulting [InfraTrack site](https://razvanjuncu.github.io/infratrack/). You don't start anything locally.
4. To re-run manually use **Actions → InfraTrack — real Sentinel-2 to GitHub Pages → Run workflow**.

If GitHub Pages is not yet enabled, use **Settings → Pages → Build and deployment → Source: GitHub Actions** once.

## Provenance and error handling
- Source: Copernicus Sentinel-2, via Element 84 STAC and public Cloud Optimized GeoTIFFs.
- Mapped road geometry: © OpenStreetMap contributors (ODbL), fetched from Overpass or the official OSM API with explicit way IDs. The geometry is not the authoritative road project surveyed alignment.
- The page displays **NO VERIFIED OBSERVATION** if data cannot be retrieved.
- Synthetic arrays are used strictly in `tests/` to check deterministic math — never in public imagery.
- Real scene identifiers, dates and the processed area appear in `site/data.json` once a run succeeds. Runtime output is deployed as a Pages artifact, not committed back to GitHub.

## Stack
Python · Rasterio · NumPy · SciPy · PyProj · Pillow · GitHub Actions · GitHub Pages · vanilla HTML/CSS/JS.

**Cost model:** no paid provider or server is required for the initial GitHub Free public-repository experiment; subject to GitHub Actions/Pages usage limits and availability of public imagery services.

## Next experiments
1. Verify the OSM corridor against official alignment files and source-dated on-site imagery.
2. Collect independent, date-specific labels from different sites; only then train a construction-vs-harvest classifier and calculate site-held-out precision/recall and confusion matrix.
3. Use seasonal repeat imagery to reduce crop false positives; the current NDVI timeline is descriptive, **not** a reliable construction classifier.
4. Expand from the current 2 km sample to the full 8.6 km lot only after validation.
5. Add a project watchlist only after measured reliability has been demonstrated.

## ML context & limitations (v0.2)

The ESA WorldCover 2021 land-cover baseline is freely available under CC BY 4.0. It was produced by an external ML classification process with non-perfect classification accuracy. The baseline is **historical**: land mapped as cropland in 2021 may have become an actual motorway by 2025, so those changes are shown for manual review rather than excluded outright.

The 2026 follow-up is evidence of persistence only, not an infrastructure classifier. Low vegetation in two summer seasons can also occur in agriculture. No numerical model confidence, roadwork percentage or authoritative progress is generated. ESA WorldCover attribution: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.

An optional, separately validated CPU/ONNX earth-observation model may be added after measuring false positives on ground-truthed examples. Generic image-caption models are not appropriate proof of construction at Sentinel-2's 10 m pixel size.

## v0.3 — corridor pilot

The old demonstration was centered near 44.5128, 26.2795 and largely captured agricultural land away from the motorway. In v0.3 the experimental center is **44.5065, 26.2328**, selected near OSM ways 1517261128/1517261130 and adjacent mapped A0 Lot 3 geometry. All coordinates are research approximations derived from community cartography, not cadastral facts. The base map uses Leaflet and normal on-demand OSM tiles with visible attribution (do not bulk-download tiles). The 130 m road buffer is an analytical choice, not the legal footprint of the project.

**Model honesty:** No neural construction classifier has been integrated yet. ESA WorldCover land-cover classes were generated with ML. Additional multi-year NDVI and the corridor mask are deterministic evidence-based filters. We will not present low vegetation as a confirmed bridge, highway or percentage of work completed.


## v0.5 — Validation Lab (research / NOT a validated AI)

The live browser application now supports a **real Sentinel-2 pixel inspector**: on the map select a point inside the 2 km satellite rectangle, or tick "Inspect pixel" below and click the before/after image. It shows NDVI, BSI and NDBI on the four acquired observations, original scene dates and the 2021 WorldCover label for context. The maps measure source pixels on the actual UTM 10 m study grid; SWIR native resolution is 20 m and its resampled readings **do not create extra detail**.

### Sourced data annotation workflow

1. Inspect a pixel **and compare to truly independent dated evidence** (for example, a dated ground-level image, an aerial survey with clear capture date, or an attributable construction progress document that resolves the exact point and period).
2. Choose exactly one label: \`construction\`, \`agriculture\`, or \`unchanged\`.
3. Enter a **site group** (same physical location = same group across samples), public evidence URL, evidence date and a concrete rationale; affirm that you checked it.
4. Click **Create annotation issue on GitHub** and manually submit the prefilled issue. Only issues created by repository owner are imported. No token, local server, or Colab needed.
5. The \`InfraTrack label intake\` workflow validates the structured issue and commits it to \`labels/reviewed.jsonl\`; it requests a Pages build through GitHub Actions. This automation requires the GitHub repository to allow Issues and Actions write permissions. If organization/repository policies block the write, inspect the workflow logs; no label is silently fabricated.

**Labels are owner-attested and evidence-linked, NOT automatically independently audited.** Their quality must be checked in addition to the mechanics.

### Training and evaluation

\`scripts/train_validation.py\` reads only site-grouped, owner-reviewed labels tied to the *exact four real Sentinel-2 scenes* via a SHA-256 scene signature. It will not train or report accuracy without at least **6 valid labels AND 3 different site groups for EACH of the 3 classes**. The study must include different ground-truth locations, not just adjacent pixels in one field.

When the threshold is reached, a lightweight scikit-learn RandomForest is evaluated by **held-out geographic site groups** and exposes the actual class-wise precision, recall, counts and confusion matrix in \`site/validation_v05.json\` and the UI. These will remain *local experimental metrics*, with **no claim of generalization to other road projects, continents or construction types**. A held-out test may be too small to draw reliable conclusions even after the minimum threshold.

If there aren't enough labels, \`validation_v05.json\` deliberately shows \`needs_labels\` with null accuracy, and **no trained classification overlay** is generated. All displayed v0.4 overlay patches remain heuristic, not a learned construction classification. Synthetic measurements are used in unit tests ONLY, never in the published data or labels.

The GitHub Actions workflow fetches real Sentinel imagery, builds the four-observation pixel featurepack, and evaluates any accepted labels during deployment. Zero paid inference/API requirements; computing time and provider/Actions quotas still apply.


## Quick Review — four buttons, no setup (new)

Open the [live InfraTrack site](https://razvanjuncu.github.io/infratrack/) and use **Quick Review**, above the older analysis panels.

1. You see **two cropped windows from the real, sourced Sentinel-2 observations**, both around the same 10 m pixel. This is still satellite-scale data; visual ambiguity is expected.
2. Choose **Construction**, **Agriculture**, **Unchanged**, or **Unsure / Skip**. The app automatically selects the next unreviewed candidate; Previous, Next, and Undo also work.
3. Responses are **provisional drafts, stored only in the current browser's localStorage**, scoped to the exact satellite scene signature. They are **not synced to GitHub** and **never used as ground-truth training examples**. You can export a draft JSON backup. A private browser or cleared site data will lose drafts without a backup.
4. When you have genuinely independent dated evidence (e.g., a source-dated ground photo), go back to that candidate and press **Verify selected draft for AI training**. This reveals the advanced evidence form and preselects the class; submit the GitHub issue manually. The existing owner-only intake validates mandatory evidence before an example is considered for possible training.
5. If the satellite view is ambiguous, choose **Unsure**. No annotation is verified just because it looks convincing at 10 m resolution.

**Important:** There is no automatic trust promotion. Machine learning only uses the separate \`labels/reviewed.jsonl\` file, populated through the evidence-gated workflow. Even those owner-attested sources are not independently audited. The site still does not claim a working/validated construction detector until sufficiently independent ground-truth samples and held-out evaluation are available.

The four-button logic has no paid services and runs entirely in static JavaScript. Both Python tests and Node built-in tests run on GitHub Actions.

## Training question revision: change-types-v2 (2026-11-04)

The simple Training screen now asks **"What changed between BEFORE and AFTER?"**, not "What sort of land is this?". The choices are *Construction change*, *Agricultural change*, *No significant change*, and *Can't tell*. Farmland may be unchanged when both images show essentially the same field; agricultural change requires visible crop/harvest/ploughing change rather than mere agricultural land use.

Because earlier review rounds were collected under an ambiguous land-use/change question, those v1 drafts are **preserved in their original browser localStorage namespace**, but **never interpreted as v2 change classifications**. New entries use the separate `infratrack:quick-review:v2:change-types:` namespace and export with `question_version: "change-types-v2"`. Previous exported JSON files remain historical exploratory responses; no automatic conversion or model training from them. The source-verified issue intake and model-training gate also reject labels that lack the revised explicit question version. Resubmission under the revised question and independent dated evidence is necessary for training.
