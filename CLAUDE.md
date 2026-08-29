# CLAUDE.md — working rules for this repo

`SPECIFICATION.md` is the source of truth. Read the relevant section before
changing anything; if code and spec disagree, the spec wins and the
disagreement gets flagged, not silently resolved.

## Domain purity

Everything in `src/domain/` (`scaling.js`, `units.js`, `recipe-jsonld.js`)
is pure and dependency-free: no imports outside
`src/domain/`, no Node built-ins, no DOM. It runs unchanged in the server and
in the browser (served as-is at `/js/domain`, never copied into `public/`).
A test reads these files as text and fails if an import creeps in — don't
work around that test, keep the code clean instead.

The server render and the client-side recalculation must call the *same*
domain code. Never add a second implementation of scaling, rounding, or
quantity formatting anywhere else.

## Rounding

Round exactly once, in the unit the reader will actually see, before any
conversion up. Which unit that is depends on the reader's measurement system
(spec §7.6): `g`/`ml` under metric, `oz`/`fl oz` under imperial. The conversion
into that unit is exact and unrounded; the §7.3 ladder is then applied once, to
that number.

Get it backwards and you get two different wrong answers. Round after
converting up and 1250 g displays as 1.3 kg instead of 1.25 kg. Round in grams
and then convert and 250 g displays as 8.82 oz instead of 8.8 oz — a number
nobody would write on a shopping list.

## Data access

All SQL lives in `src/repositories/`. Every function that loads a recipe
takes the acting user id and enforces access in the SQL itself (see spec
§5.1) — no loading first and checking in JS after. The one exception is
share-token lookup (public share route), and that exception is commented at
the call site as such.

Unauthorized access to a recipe answers `404`, never `403` — existence of a
recipe someone doesn't own is not information to leak.

## Logging

Never log share tokens. Use `redactPath`/`redactTokens` wherever a path or
URL might contain one; a log file is not a place for a capability URL.

## Secrets

Never commit `.env` or `data/` — this repository is public.

## Docker

The Dockerfile must not rely on the build context's file permissions — the
Raspberry Pi's deploy script may clone this repo under a restrictive umask.
Copied files are given to the `node` user explicitly via `--chown` on COPY.

Any reverse proxy in front of Bring2Bring! must forward `X-Forwarded-Proto: https`, or the `secure` session cookie never gets set and login silently fails in production.

## Content Security Policy

No inline scripts, anywhere. The CSP (`src/app.js`) has no nonces and must
not gain any — all client JS ships as external files.

## Tests

Every scaling or unit change needs a test (spec §14). Run:

- `npm test` — full suite
- `npm run seed:admin` — create/update the admin account from `ADMIN_USER` /
  `ADMIN_PASSWORD`
- `npm start` — run the server; migrations run automatically at startup,
  before the server listens

## Acceptance

Spec §13 lists the acceptance criteria. Criteria 7 and 8 can only be checked
on the real Raspberry Pi with a real phone running the real Bring! app — they
cannot be verified from a dev machine or CI.
