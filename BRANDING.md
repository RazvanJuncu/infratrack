# InfraTrack — Carbon / Sand

**Decision:** Carbon / Sand selected as the production interface palette on 2026-11-04.
**Application:** https://razvanjuncu.github.io/infratrack/
**Repository:** https://github.com/RazvanJuncu/infratrack

## Design intent

InfraTrack is an evidence-led, geospatial observation workspace. Real satellite imagery is the protagonist: surrounding controls should be quiet, compact and honest about data limitations. Avoid the stacked-card, neon-accent, gradient-heavy aesthetic of generic AI dashboards.

### Palette

| Token | HEX | Role |
|---|---|---|
| Carbon | `#15191C` | App background |
| Graphite | `#1B1F22` | Navigation |
| Panel | `#24292D` | Large workspace surfaces |
| Elevated | `#2B3034` | Secondary control fill |
| Border | `#383E41` | Fine structural separators |
| Ivory | `#E8E9E5` | Primary text and imagery controls |
| Muted | `#A5AAA8` | Metadata and secondary copy |
| Sand | `#D49A58` | Single interaction/selection accent |
| Change red | `#D75C56` | Experimental visual differences and risk signals |

Sand is **not** used to depict image differences. Cloud/quality warnings may use warm sand, while actual highlighted raw pixel differences retain a separate red color and an explicit experimental label/caveat.

## Shape and spacing

- Large windows, data panes, preview surfaces, and dialogs: **90° corners (0 px radius)**.
- Small actions, filters, links, tab navigation and selects: **capsule/pill geometry**.
- Flat watchlist/timeline rows, with small separators rather than individually boxed cards.
- No gradients, unnecessary glow, or decorative shadow stacks.
- Keep satellite canvas prominent. Never substitute generated satellite art for genuine source imagery.
- Keep functional descriptions concise. Do not conceal uncertainty or data provenance.
- Icons are monochrome line SVG assets embedded as CSS masks for primary navigation and major actions. Visible labels remain for usability and accessibility.

## Type

- **Geist Sans:** primary product UI (400–600).
- **Geist Mono:** dates, scene IDs, coordinates, technical readouts.
- Do not use large bold marketing headlines in analysis views.

## Engineering invariants

- Shared production design system is `site/brand.css`; loaded last on Monitor, Training and Technical pages.
- `site/mark.svg` is the compact, square-corner observation-frame mark.
- The existing IDs, JS hooks, local storage keys, observation sources, and alignment/difference computations must remain intact.
- Preserve keyboard focus, input labels, dynamic status announcements, drag-and-drop, and screen-reader semantics.
- Brand lab and legacy archived pages are historical explorations; live product is InfraTrack.
- InfraTrack currently presents real imagery and experimental differences, **not** a verified AI construction detection system.

## Superseded exploration

The prior Quiet Precision / Sage Mint exploration is superseded by Carbon / Sand. The previous naming candidates (Wherewhile, Terrafter, PlotShift) remain research concepts, not product renames or cleared marks.
