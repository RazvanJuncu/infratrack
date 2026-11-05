# 🛰️ InfraTrack · Earth Observation Alpha

## Current product layout (v0.8+)

- **[Monitor](https://razvanjuncu.github.io/infratrack/)** — public Sentinel-2 STAC observations, browser-saved Europe-wide custom 2 km areas, and **on-demand real RGB before/after GeoTIFF crops for custom areas** using GeoTIFF.js / proj4. The 5 registered sites also publish cloud-screened, server-processed comparisons. Custom areas are not processed server-side or monitored in the background. The image preview depends on COG availability, CORS and locally usable scenes, and reports failures rather than fabricating photos.
- **[Training](https://razvanjuncu.github.io/infratrack/training.html)** — separate two-question review of *recent significant spectral changes*: apparent type of change and confidence. Drafts stay local and are not used as training truth.
- **[Technical](https://razvanjuncu.github.io/infratrack/technical.html)** — current multi-region dashboard with recent scene IDs, observation dates, local clear overlap, unverified change scores, ground-truth validation state and published source files. The original A0-only prototype is archived at **[technical-legacy.html](https://razvanjuncu.github.io/infratrack/technical-legacy.html)**.

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


## v0.8 — Monitor + recent change training

**Monitor (home)**:
- Map-first European study-area selection, 2×2 km square, name and interest type. Custom watchlists are kept only in the same browser's localStorage (up to 50); no account, paid service or false claims of permanent cloud processing.
- For ANY user-selected European area, the public Element84 Earth Search STAC catalog is queried on page load and on manual Refresh; show source-dated **acquisition metadata** for 30, 90 or 180 days. Cloud percentages are for the entire Sentinel scene; catalog acquisitions do not guarantee locally cloud-free imagery. These client-side fetches depend on browser CORS and availability of the public catalog.
- For FIVE registered Romanian AOIs with processing enabled, a GitHub Actions job additionally downloads true-color crops from two independent recent, locally cloud-screened Sentinel-2 scenes (up to 115 days back), showing dates and real scene IDs. If it cannot find a usable pair, report unavailable/fallback rather than inventing recent imagery.
- Scheduled **daily** Github Actions workflow refreshes registered sites; this is not yet automated image processing for arbitrary browser-saved user AOIs, and is not a verified construction alert service. The browser rechecks public metadata on opening, Refresh or once an hour while visible. **No push/email alerts**.
- Research preview detection uses 5×5 patches of absolute NDVI or RGB reflectance change from recent observed data; groups selected at least ~200m apart. Cloud-masked pixels are excluded, and candidate labels are **never inferred** from magnitude alone.

**Training (separate tab)**:
- The queue is generated from actual recent significant-change candidates, not a random land-use snapshot or historical 2023/2025 examples.
- Two questions per candidate: **What appears to have changed?** (construction activity / agriculture / vegetation or land-cover / other / no meaningful change / can't tell) and **How confident?** (confident / somewhat / not very). "Can't tell" skips the confidence question. The detector does **not** assert candidate causes or worksite status.
- All review responses remain local browser drafts under a **separate source-scene-specific key**. JSON export explicitly says not ground truth and not eligible for ML training. No trained model or accuracy claim is implied.
- Legacy 4-button and independently evidenced review UI remains accessible via a separate advanced link. It is not mixed with new recent questions.
- A later phase must safely support server-side processing of arbitrary user AOIs, automated verified labels, geographic holdout and server-side alert delivery. **Do not conflate the metadata-only personal watchlist with such a production service.**

Sentinel-2 nominal satellite revisit is ~5 days at the equator, generally more frequent at European latitudes, but visible cloud-free observations can be much farther apart. We process only when usable actual scenes exist.

### On-demand custom-area imagery (fix for empty Recent satellite comparison)

Previous Monitor versions intentionally showed only acquisition dates for a user-saved area, leaving its Before/After comparison blank; this conflicted with the Monitor product goal. Custom areas now attempt to read two distinct, sufficiently recent Sentinel-2 `visual` Cloud-Optimized GeoTIFFs, crop the true-color pixels to the selected 2 × 2 km square in browser JavaScript, and optionally screen local `scl` cloud/land-cover quality. The renderer uses public AWS COG assets; it cannot promise two clear observations, and it shows explicit errors for unavailable CDN scripts, missing visual COGs, incorrect coverage, Cloud Optimized GeoTIFF read/CORS failures, or clouds. This is on-demand **visual comparison**, not a background change alert or construction classifier. The site always retains the public STAC acquisition list and a 180-day date-range option.


## Manual observation date selection and overlay

In **Monitor → Satellite observation history**, every acquisition with an accessible original Sentinel-2 visual asset is now a selectable card. The cloud-cover percentage remains visible and refers to the **entire STAC scene**, not necessarily the selected 2×2 km square. Click a date once to load that **exact STAC scene ID** and one true-color crop. Click a second date to compare exactly those two source scenes. The viewer chronologically places the older scene on the left/underlay (**Before**) and the newer as **After**, with an opacity-like swipe **slider** that reveals more/less of the newer scene. A **Side by side** option is also available. Clicking a chosen card again deselects it; choosing a third date replaces the oldest *selection*, not necessarily the oldest acquisition date. **Clear selection** returns a registered area to its processed pair, or a custom area to the date-selection prompt.

The two selected crops come from the **same geographic 2 km bounding square** and are resampled to the same pixel dimensions for visual overlay. Exact pixel-level orthorectification/co-registration across distinct UTM tile grids is not independently validated; some residual differences may exist. The viewer does not substitute an alternative scene if one chosen date fails due to clouds, missing coverage, CORS, or a corrupt asset. Instead it reports that selected scene's failure. Locally cloud-screened imagery is best effort, and selected user imagery does **not** mean a verified change detection or an AI training label. The earlier automatic comparison remains a default only for the five preprocessed sites, before any explicit selection.


## v0.9: Conservative residual co-registration before comparing two observations

Sentinel-2 L2A data are already orthorectified onto a cartographic grid. Exact ground-pixel alignment can nevertheless vary between orbits and dates, especially with topographic relief, sensor viewing differences and imperfect geolocation. **A matching bounding box does not prove image co-registration.**

The browser now retains a local *scene classification* (SCL) clear-pixel mask with each original 2×2 km RGB crop and applies a **small, feature-based residual affine registration** whenever two real Sentinel-2 observations enter the Canvas. The engine finds textured corner features across multiple parts of the window, matches local brightness-normalized image patches between dates, fits a constrained 2D affine correction from consistent correspondences, and reports its feature count, residual RMS error and maximum correction. The warp is limited (<=6 display pixels, mild shear/scale); it never applies a rubber-sheet or unconstrained deformation to force real earthworks to match historical imagery.

**Fail closed:** if there are too few stable landmarks, the matches are ambiguous, the estimated geometry is physically implausible, or either SCL mask is missing, the original imagery is displayed **side by side** with an explicit "alignment not verified" warning. The overlaid swipe comparison and "Highlight differences" are disabled until the registration passes its acceptance rules.

The experimental raw RGB threshold overlay uses the *warped-to-reference* newer image, not the unregistered one. It now excludes invalid/cloud/shadowed SCL pixels on **both dates** and excludes uncovered warp-edge pixels. This is still **not** trained AI, certified construction-change segmentation, physical ortho-rectification of elevated objects or a calibrated change probability. Small parallax distortions of tall structures can survive a successful affine registration. The resulting registration confidence is a quality heuristic, not an external geodetic accuracy certification.

Synthetic regression tests cover known pixel translations, small tilt/scale, changed construction-like patches, blank/clouded surfaces, huge shifts, geographically isolated matches, and avoidance of erroneous change highlights. Runtime behavior with specific external Sentinel images remains dependent on usable optical scenes, cloud metadata and original COG services.


## Change Intelligence 1.0 — stage 1 (experimental)
The Monitor now tries a **conservative bidirectional stable-edge translation fallback**
only when the existing residual affine registration fails. It requires at least
eight matched features, geographically distributed agreement, reverse matching,
low residual error, and no more than 5 display pixels of shift. If either method
cannot establish credible alignment, the original scenes are shown side by side
and **no** change overlay or event is reported.

For accepted pairs, the browser groups RGB differences into connected candidate
regions. It uses local cloud masks, limited per-channel illumination offsets, and
spatial filtering to suppress isolated noise. Region boundaries are **image-pixel**
coordinates, not surveyed property footprints. The displayed changes are
unverified, not AI classifications, and can reflect agriculture, seasonality,
lighting or remaining misregistration. No precision, recall or accuracy claim is
possible without a separately labeled real-scene benchmark. This release does
not provide background processing for every personal area.
