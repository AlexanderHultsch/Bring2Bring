# Logo explorations

Five directions for the Bring2Bring! symbol. Every mark is two bold geometric
capital B's overlapped into a single form, with the channel they leave between
them cut as the number 2 — the 2 exists only as the letters' shared negative
space.

- `marks.mjs` — the geometry. Each mark is one SVG `<mask>`: the B forms are
  painted white, the 2 is stroked black through them. The B's, the 2 and the
  waist notches are the only primitives.
- `gen.mjs` — regenerates the presentation artboards from `marks.mjs`.
- `*.dc.html` + `canvas.json` — the design canvas artboards.

Regenerate the artboards after changing the geometry:

    node gen.mjs

The seeded canvas page is a build output and is not committed.
