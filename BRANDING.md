# Quiet Precision · InfraTrack brand exploration

**Stage:** Design system implemented. **Product name not decided.**
**Candidate preview:** https://razvanjuncu.github.io/infratrack/brand-lab.html
**Live software:** https://razvanjuncu.github.io/infratrack/

## Positioning

Earth observation for the places that matter. A minimalist workspace to inspect real satellite observations, compare changes through time, and keep raw evidence visible. The brand must remain credible when the AI system has no answer; the visual identity must not imply independently verified construction changes where only raw RGB differences exist.

Short line: **See what changes. Where it matters.**

Voice: precise, warm, calm; use active words, clear sources and dates. Never use exaggerated AI accuracy claims, invented geographic data, or glossy synthetic satellite imagery. The images are the product's visual protagonist.

## Naming directions under review

1. **Wherewhile** — where + while; playful link of geography and time; not immediately descriptive. Candidate favored for visual exploration, *not legally cleared*.
2. **Terrafter** — terra + thereafter; compact coinage. Search results are not a trademark or domain search.
3. **PlotShift** — plot of land + change/plot twist. Existing commercial uses identified; not advised for launch without legal clearance.
4. **InfraTrack** — current name retained throughout the software until explicitly approved replacement. Original repository paths, Pages URLs, saved local browser review keys and project IDs are not renamed.

Prior concept **Earthwhile** has at least one existing floral/plant brand; not a cleared candidate.

All candidates require dedicated trademark and domain checks in relevant jurisdictions before production adoption.

## Design system

Single CSS source of truth: \`site/brand.css\` (loaded after existing page-specific layouts, leaving interaction logic intact). Source-controlled SVG observation frame mark: \`site/mark.svg\` (two offset squares and a scan/compare line). Brand preview: \`site/brand-lab.html\` (names switch only in the preview, no production storage/renaming).

| Token | HEX | Use |
|---|---|---|
| Midnight | \`#0C131B\` | Page background |
| Slate | \`#17232D\` | Panels |
| Mineral | \`#34434E\` | Dividers/borders |
| Frost | \`#EEF3F1\` | Main text |
| Sage Mint | \`#A3E4D1\` | CTA, selection, link focus |
| Amber | \`#DFB97E\` | Cloud and evidence-quality warnings |
| Coral | \`#F18E77\` | Raw difference and risk state |

## Typography

- **Geist Sans**: product UI and display titles, regular 400, medium 500, semibold 600; heavy bold used sparingly.
- **Geist Mono**: dates, coordinates, scene IDs, provenance and technical metadata.
- Font source: https://vercel.com/font (official project under OFL); Google Fonts CDN used in CSS with system fallbacks. Neither font binaries nor raster-generated mock satellite imagery are committed to brand assets.

## UI rules

- Satellite imagery is the hero. Keep chrome and gradients subdued.
- Avoid decorative map/space icon clichés, fake AI confidence bars, thick neon strokes, and heavy cards.
- One accent for actionable selection; warm amber for cloud limitations and warnings.
- Use restrained corner radii (9–13 px), high-contrast readable secondary text, subtle borders rather than strong shadows.
- Preserve keyboard focus and the native UI semantics of drag/drop, selects, buttons and links.
- Current main navigation remains Monitor / Training / Technical. No extra permanent branding tab.
- Logo must work at 24–32 px and be recognisable in monochrome.
- Prioritize accurate technical communication: visual differences, cloud contamination, temporal consistency and co-registration limitations must remain explicit.

## Implementation status

The shared styles are applied to Monitor, Training, and Technical; archived research pages are left unchanged. The brand experiment page uses illustrative text and shapes, not real or fake observation statistics. No paid AI dependency, custom API key or workspace data migration was added. The name and URL remain InfraTrack until selected.
