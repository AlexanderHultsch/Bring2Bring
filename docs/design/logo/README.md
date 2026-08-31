# Logo

The mark is at `public/img/logo.svg`, served as `/img/logo.svg`.

## The idea

Two identical bold geometric capital B's, the second turned a half turn about the
centre of the grid, overlapped into one compact form. The channel the two letters
leave between them is cut back out as the number 2 — the digit is never drawn, it
exists only as the letters' shared negative space.

Because the second B is the first rotated 180°, the two letters lock
point-symmetrically around the centre. The 2 is not part of that symmetry, so the
mark is *not* identical upside down.

## Construction

Everything sits on a 128 × 128 grid, ink spanning x 28–100 and y 12–116, centred.

| | |
|---|---|
| B stem | 16 wide, 88 tall, top-left at (28, 12) |
| B bowls | two half-discs, radius 22, centres (44, 34) and (44, 78) |
| second B | the same path, `rotate(180 64 64)` |
| the 2 | arc radius 21 centred (66, 46), stroked 14 with round caps, foot at y 98 |

The SVG is one `<mask>`: both B's are painted white, the 2 is stroked black through
them, and a single `<rect fill="currentColor">` is masked with the result. That is
what makes the 2 genuinely negative space rather than a shape sitting on top.

## Colour

The mark paints with `currentColor`. The `color="#2e7d32"` attribute on the root is
only a default so the file is correct on its own (as a favicon, or in an `<img>`).
A CSS rule always beats a presentation attribute, so when the markup is inlined the
mark follows the theme:

```css
.site-header__brand svg { color: var(--color-accent); }
```

There is deliberately no `<style>` element in the file: the app's CSP sets
`style-src 'self'` with no nonces (see `src/app.js`), so an internal stylesheet
would be blocked wherever the mark is inlined into a page.

## Other directions

Four other directions were explored — Spine, Slab, Interlock and Monoline. They live
on the `claude/bring2bring-logo-design-znzc26` branch under this path, alongside the
generator that produced them.
