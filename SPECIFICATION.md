# Dishlist — Specification v1.1

> **Status:** Concept, pre-implementation. This document is the authoritative
> source of truth for the `Dishlist` repository
> (<https://github.com/AlexanderHultsch/Dishlist>) and should be committed as
> `SPECIFICATION.md` in its root.
>
> **Context:** Dishlist is a private digital cookbook that runs as its own
> Docker container on the Raspberry Pi described in
> `AlexanderHultsch/PiMultiServiceServer`, behind Caddy and a Cloudflare
> Tunnel. It is listed on the homepage `AlexanderHultsch/ProjectIndex`
> (ahultsch.com) and is bound by the ecosystem-wide standard defined in that
> repo's `SPECIFICATION.md` §13.

---

## Changes in v1.1

The recipe editor was too heavy for real kitchen use. Everything not needed
to get correctly scaled ingredients into Bring! has been cut.

A recipe is now exactly: a name, a servings count, a flat list of
ingredients (amount + unit + name), and an optional free-text method.

Removed entirely — from the editor, the recipe page, the list, the search
and the share page: tags and tag filtering, prep/cook/total times, notes,
source name and URL, subtitle, description, ingredient groups, the
per-ingredient `scales`/`exclude_from_shopping` toggles, the free-text
quick-add line and its parser, and drag/move reordering. Multi-entry steps
with section titles are replaced by a single method textarea, stored and
shown exactly as typed.

The database schema (§5) is unchanged — removed columns/tables sit unused at
their defaults; nothing migrates, nothing is destroyed, and any of this can
come back later by adding a form field.

---

## 1. Purpose

Dishlist is Alex's own private cookbook on the web. Recipes are entered once,
viewed on a phone in the kitchen, scaled to any number of servings, and — this
is the whole point of the project — pushed into the **Bring! shopping list app
in one tap**, with correctly scaled quantities, instead of being typed in by
hand.

It is explicitly **not** a recipe blog, not a meal planner, and not a social
platform. There are no cooking tips, no comments, no ratings — just recipes.

### Guiding principles (binding for all decisions)

1. **Simple, modular, timeless.** It must still run in five years without a
   rewrite. Minimal dependencies, no build step, no framework churn.
2. **Small now, not painted into a corner.** Realistically one to a handful of
   users. The architecture must not *assume* a single user, but must not pay
   the price of a system built for thousands either.
3. **Security before convenience.** The app is reachable from the public
   internet. Exactly one route is public by design (the share page); every
   other route requires a session.
4. **Debuggable by Claude Code.** Plain, boring, readable code; clear layer
   boundaries; useful logs; no clever metaprogramming.
5. **The Bring! export must never produce a wrong shopping list.** A wrong
   quantity is worse than no export.

---

## 2. Decisions already made (from the requirements interview)

| Topic | Decision |
| --- | --- |
| UI language | **English**, single language, no i18n layer. Recipe *content* is whatever the user types (typically German). |
| Multi-user | **Full user registration and recipe sharing from day one.** |
| Registration | **Invite-code only** (see §6.2). |
| Recipe visibility | **Private by default**, explicitly shareable to individual users. |
| Public share link | **Permanent random token per recipe, off by default, toggleable and revocable per recipe.** |
| Additional outputs | Copy ingredients as text, JSON export, print view. |
| Hosting | Own Docker container on the Pi, behind Caddy + Cloudflare Tunnel. |

### 2.1 Ingredient and yield model — decided in v1.1

A1–A4 were originally assumptions, to be confirmed before implementation.
v1.1 confirms — and cuts down — most of them; see "Changes in v1.1" above
for why. This resolves open question 1 (§16).

- **A1 — Ingredient entry:** structured fields only — `amount | unit | name`.
  No `note` field, no free-text quick-add line, no parser. An ingredient
  amount may be left blank ("Salz" with no number); a non-numeric amount is
  still a validation error, per §11's "reject rather than coerce".
- **A2 — Non-linear ingredients:** the `scales` and `exclude_from_shopping`
  columns still exist and the export logic that reads them still works
  (§13 criterion 6), but the editor has no UI to set either — every
  ingredient entered through the editor scales normally and ships to
  Bring!. Scaled results are rounded by the rules in §7.3.
- **A3 — Yield:** a recipe has a numeric servings count and nothing else —
  no unit choice, no free-text label override. The `yield_unit` and
  `yield_label` columns remain in the schema at their defaults (§5).
- **A4 — Ingredient groups:** removed. Every recipe has exactly one flat
  ingredient list — the schema still has `ingredient_groups`, but every
  recipe now gets exactly one such row, with `name = NULL` (§5).

---

## 3. Binding platform contract

This repo **must** satisfy the ecosystem standard from
`ProjectIndex/SPECIFICATION.md` §13 verbatim:

1. `Dockerfile` in the repository root — the app runs as its own container.
2. Listens on `process.env.PORT`, default `3000`.
3. Starts with no arguments: `node server.js`.
4. SQLite database file at `process.env.DB_PATH`, default `./data/dishlist.db`.
   The host mounts `/data` as a volume.
5. Secrets **only** from environment variables, never hardcoded, never
   committed: `SESSION_SECRET`, plus `ADMIN_USER` and `ADMIN_PASSWORD`.
6. `npm run seed:admin` creates/updates the admin account from
   `ADMIN_USER` / `ADMIN_PASSWORD`. Idempotent.
7. `.env.example` lists every variable with placeholder values; the real
   `.env` is in `.gitignore`. **The repository is public.**

### 3.1 Environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `PORT` | no | `3000` | HTTP listen port |
| `DB_PATH` | no | `./data/dishlist.db` | SQLite file |
| `UPLOAD_DIR` | no | `./data/uploads` | Recipe images |
| `SESSION_SECRET` | **yes** | — | Session cookie signing key |
| `ADMIN_USER` | **yes** | — | Admin login name, used by `seed:admin` |
| `ADMIN_PASSWORD` | **yes** | — | Admin password, used by `seed:admin` |
| `PUBLIC_BASE_URL` | **yes** | — | e.g. `https://dishlist.ahultsch.com`; used to build absolute share URLs for Bring! |
| `TRUST_PROXY` | no | `1` | Express `trust proxy` hops (Caddy + cloudflared) |
| `NODE_ENV` | no | `production` | |

`PUBLIC_BASE_URL` is not optional: Bring! fetches the share page from its own
servers, so the app must be able to construct an absolute, externally valid
URL. Relative links are useless here.

---

## 4. Technology choices

| Layer | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js 24 LTS (`node:24-alpine` base image) | Matches the Pi's existing app-example |
| HTTP | Express 5 | Boring, stable, well known to Claude Code |
| Views | **Server-rendered EJS templates** | Bring! parses HTML from its own servers — a client-rendered SPA would deliver an empty page to the parser. Server rendering is not a preference here, it is a requirement. |
| Client JS | Vanilla, progressive enhancement, no build step | Matches ProjectIndex convention; scaling recalculation happens client-side for instant feedback but the server render is always complete and correct on its own |
| Database | SQLite via `better-sqlite3` | Single file, matches the contract, trivial to back up |
| Sessions | `express-session` + SQLite session store (`better-sqlite3-session-store`) | Sessions survive container restarts |
| Passwords | `argon2id` (fallback `bcrypt` if `argon2` fails to build on ARM64) | |
| Security headers | `helmet` | |
| Rate limiting | `express-rate-limit` | |
| Validation | `zod` | One schema per form, used for both API and form posts |
| Image handling | `multer` + `sharp` (resize/strip EXIF) | If `sharp` proves painful on ARM64, fall back to accepting only pre-sized uploads with a hard size cap |
| Tests | `node:test` (built-in) + `supertest` | No extra test framework |

**No frontend framework, no bundler, no CSS framework, no TypeScript build
step.** If a dependency needs a compiler toolchain to install on a Raspberry
Pi, that is a strong argument against it.

### 4.1 Repository layout

```
Dishlist/
├── Dockerfile
├── docker-compose.override.example.yml   # snippet for the Pi's compose file
├── .env.example
├── .gitignore                             # .env, data/, node_modules/
├── README.md
├── CLAUDE.md                              # working rules for Claude Code
├── SPECIFICATION.md                       # this document
├── package.json                           # scripts: start, dev, seed:admin, migrate, test
├── server.js                              # entry point, no arguments
├── src/
│   ├── app.js                             # express app assembly (exported for tests)
│   ├── config.js                          # env parsing + validation, fails fast
│   ├── db/
│   │   ├── index.js                       # connection, pragmas (WAL, foreign_keys)
│   │   ├── migrate.js                     # runs migrations/*.sql in order
│   │   └── migrations/001_init.sql        # …002_…, numbered, never edited after release
│   ├── domain/
│   │   ├── scaling.js                     # PURE functions, no db, no express
│   │   └── units.js                       # unit table, normalization, formatting
│   ├── repositories/                      # all SQL lives here, one file per aggregate
│   ├── services/                          # use cases: recipes, auth, sharing, export
│   ├── routes/                            # thin: parse, authorize, call service, render
│   ├── middleware/                        # auth, csrf, rate limits, error handler
│   └── views/                             # EJS
├── public/
│   ├── css/tokens.css                     # ALL colors, fonts, spacing, radii
│   ├── css/style.css                      # layout & components, reads tokens only
│   └── js/                                # scaling.js (shared with domain), app.js
└── test/
```

**`src/domain/scaling.js` and `src/domain/units.js` must be pure, dependency-free
modules** that run unchanged in Node and in the browser. The server render and
the client-side live recalculation must use the exact same code — two
implementations of the same rounding rules will drift, and a drifting shopping
list is the one failure mode this project cannot afford.

---

## 5. Data model

SQLite, foreign keys on, WAL mode. All ids are `INTEGER PRIMARY KEY` except
where a public token is needed.

```sql
users (
  id, username UNIQUE, email UNIQUE NULL, password_hash,
  role TEXT CHECK(role IN ('admin','user')) DEFAULT 'user',
  created_at, last_login_at
)

invites (
  id, code UNIQUE, created_by -> users.id, created_at,
  expires_at NULL, used_by -> users.id NULL, used_at NULL
)

recipes (
  id, owner_id -> users.id,
  title, subtitle NULL, description NULL,
  yield_amount REAL NOT NULL DEFAULT 4,
  yield_unit TEXT NOT NULL DEFAULT 'servings',
  yield_label NULL,                     -- free-text override
  prep_minutes NULL, cook_minutes NULL, total_minutes NULL,
  source_name NULL, source_url NULL,    -- "Grandma", "Chefkoch", …
  notes NULL,                           -- free-form, shown at the bottom
  image_path NULL,
  is_archived INTEGER DEFAULT 0,
  share_token TEXT UNIQUE NULL,         -- NULL = sharing off
  share_enabled INTEGER DEFAULT 0,
  share_created_at NULL,
  created_at, updated_at
)

ingredient_groups (
  id, recipe_id -> recipes.id ON DELETE CASCADE,
  name NULL,                            -- NULL = implicit default group
  position INTEGER
)

ingredients (
  id, group_id -> ingredient_groups.id ON DELETE CASCADE,
  amount REAL NULL,                     -- NULL = "to taste", no number
  amount_max REAL NULL,                 -- for ranges: 2-3 apples
  unit TEXT NULL,                       -- canonical unit key, NULL = countable
  name TEXT NOT NULL,
  note TEXT NULL,                       -- "finely chopped", "room temperature"
  scales INTEGER NOT NULL DEFAULT 1,
  is_optional INTEGER NOT NULL DEFAULT 0,
  exclude_from_shopping INTEGER NOT NULL DEFAULT 0,  -- water, salt already at home
  position INTEGER
)

steps (
  id, recipe_id -> recipes.id ON DELETE CASCADE,
  position INTEGER, text TEXT,
  section_title TEXT NULL               -- optional heading before this step
)

tags (id, name UNIQUE, created_by -> users.id)
recipe_tags (recipe_id, tag_id, PRIMARY KEY(recipe_id, tag_id))

recipe_shares (                          -- explicit sharing to a logged-in user
  recipe_id -> recipes.id ON DELETE CASCADE,
  user_id  -> users.id  ON DELETE CASCADE,
  can_edit INTEGER DEFAULT 0,
  created_at,
  PRIMARY KEY(recipe_id, user_id)
)

sessions (…)                             -- managed by the session store
```

**Schema note (v1.1):** the schema above is unchanged from v1.0 — see
"Changes in v1.1". The product now only writes a subset of it; the rest
sits unused at its defaults, and there is no migration:

- `recipes`: `subtitle`, `description`, `prep_minutes`, `cook_minutes`,
  `total_minutes`, `source_name`, `source_url`, `notes`, `image_path` are
  always `NULL`. `yield_unit` is always `'servings'`, `yield_label` always
  `NULL`.
- `ingredient_groups`: every recipe has exactly **one** row, `name = NULL`.
- `ingredients`: `note`, `amount_max`, `is_optional` are always `NULL`/`0`;
  `scales` is always `1`; `exclude_from_shopping` is always `0`. The
  columns and the export logic that reads them still work (§13 criterion
  6) — there is just no editor UI to set them to anything else.
- `steps`: exactly **one** row per recipe, `position = 0`,
  `section_title = NULL`, holding the method text verbatim.
- `tags` / `recipe_tags`: unused, always empty.

Any of this can come back later by adding a form field, not by changing the
schema.

### 5.1 Authorization rules

A user may **read** a recipe if they own it, or it is in `recipe_shares` for
them. A user may **write** a recipe if they own it, or the share row has
`can_edit = 1`. Admins have no implicit read access to other users' recipes —
being able to reset a password is not the same as reading someone's cookbook.
Every repository function that loads a recipe takes the acting user id and
enforces this in SQL, not in the route.

The single exception is the public share route (§8), which loads by token and
by definition has no acting user.

---

## 6. Authentication and accounts

### 6.1 Login

- Username + password, `POST /login`, session cookie.
- Cookie: `httpOnly`, `secure`, `sameSite=lax`, rolling 30-day expiry,
  regenerated on login (session fixation).
- Rate limit: 10 attempts per 15 minutes per IP **and** per username; generic
  error message that does not reveal whether the username exists.
- `POST /logout` destroys the session. CSRF-protected like every other POST.

### 6.2 Registration

- `GET/POST /register` requires a valid, unused, unexpired invite code.
- Invite codes are created by an admin at `/admin/invites`: 32-character
  random, single use, optional expiry, revocable.
- Without a code the registration form still renders but cannot be submitted —
  it never confirms whether a given code exists until submission.
- The admin account is created by `npm run seed:admin`, not by registration.

### 6.3 Password handling

- Argon2id with sensible memory cost for a Raspberry Pi (start at 19 MiB,
  `timeCost 2`, `parallelism 1`; tune if login latency exceeds ~500 ms).
- Self-service password change at `/account`. Admin can trigger a password
  reset by generating a one-time reset link — **no email sending**; the link is
  displayed to the admin, who passes it on. A mail server is out of scope
  (see the Pi repo's reasoning on why email is not hosted there).

---

## 7. Scaling engine

This is the core domain logic and deserves its own tests.

### 7.1 Model

Every recipe is stored at its **base yield** (`yield_amount`). Scaling never
mutates stored data. A requested yield produces a factor:

```
factor = requestedYield / baseYield
```

For each ingredient:
- `scales = false` → amount unchanged, factor ignored.
- `amount IS NULL` → nothing to scale ("salt to taste").
- otherwise → `amount * factor`, then unit normalization (§7.2), then
  rounding (§7.3). Ranges scale both `amount` and `amount_max`.

### 7.2 Unit normalization

`src/domain/units.js` holds the table of known units, each with: canonical
key, display label, dimension (`mass`, `volume`, `count`, `spoon`,
`pinch`), base factor, and whether the unit may be auto-converted.

Since v1.1 (§2.1 A1) the unit field in the editor is a closed dropdown, not
free text, so the table is deliberately small — exactly:

| key | label | dimension |
| --- | --- | --- |
| `piece` | (empty string) | count |
| `g` | g | mass |
| `kg` | kg | mass |
| `ml` | ml | volume |
| `l` | l | volume |
| `tsp` | TL | spoon |
| `tbsp` | EL | spoon |
| `pinch` | Prise | pinch |
| `stueck` | Stück | count |

"No unit" is stored as the `piece` unit (count dimension with empty label), so
`2 Eier` renders without a unit word while still getting the count rounding
rule (§7.3: nearest 0.5, never below 0.5). This is a deliberate internal
representation, not an accident — it lets `piece` (displayed as "2 Eier")
and the new `stueck` unit (displayed as "2 Stück Butter") share the count
rounding and conversion rules while differing only in the label shown.
The `stueck` unit is new in v1.1.

Rules:
- Convert **up** when the scaled amount gets unwieldy: `1500 g → 1.5 kg`,
  `2000 ml → 2 l`.
- Convert **down** when it gets fiddly: `0.25 kg → 250 g`, `0.5 l → 500 ml`.
- Never convert across dimensions (no ml→g; that needs densities and is
  explicitly out of scope).
- `tsp`, `tbsp`, `pinch` and both count units (`piece`, `stueck`) never convert
  into anything else.
- There is no free-text or unknown unit any more — the dropdown is closed,
  so every stored `unit` value is one of the keys above.

### 7.3 Rounding rules

Rounding happens **only for display and export**, never in storage.

| Case | Rule |
| --- | --- |
| ≥ 100 (g, ml) | round to nearest 5 |
| 10–99 | round to nearest 1 |
| 1–9.99 | 1 decimal place |
| < 1 | 2 decimal places, and prefer a converted-down unit if one exists |
| `count` dimension (eggs, onions) | round to nearest 0.5, never below 0.5 |
| `pinch`, `to taste` | never numeric |

Trailing zeros are stripped (`2.0 → 2`). Decimals are rendered with the
locale-appropriate separator for the *content* language of the recipe; default
`de-DE` formatting (comma) since the recipes are German — this is a display
setting in `config.js`, not scattered through templates.

### 7.4 UI behaviour

- The recipe page has a yield control: `−  [ 4 ] servings  +`, plus quick
  presets (`×0.5`, `×2`) and direct numeric entry.
- Changing it recalculates ingredient amounts **client-side without a page
  reload**, and updates the URL query (`?yield=6`) via `history.replaceState`
  so the state is linkable and reloadable.
- Server render always honours the `yield` query parameter, so the page is
  correct with JavaScript disabled and correct for any external parser.
- Scaled values that were rounded show the exact value in a `title` tooltip.
- The editor has no UI to mark an ingredient `scales = false` (§2.1 A2), so
  in practice every ingredient scales — there is no "unchanged" marker to
  show.

---

## 8. Public share page and Bring! integration

**This is the feature the whole project exists for. Get it right.**

### 8.1 How Bring! actually works

Bring! does **not** receive data from the browser. The deeplink endpoint takes
a URL, and **Bring's own servers fetch that URL** and parse it for
schema.org/Recipe data. Consequences:

- The share page must be reachable **from the public internet without a
  session, without a cookie, without a redirect to login**.
- It must be server-rendered HTML with complete recipe markup.
- It must be reachable by an arbitrary, non-browser user agent from an
  unknown IP — so Cloudflare bot rules, Access policies, and aggressive rate
  limiting must not block it.

### 8.2 Share tokens

- `share_token` is 32 bytes from `crypto.randomBytes`, base64url-encoded.
- Sharing is **off by default**. The recipe page has a "Public link" section
  with: enable, copy link, rotate token, disable.
- Disabling sets `share_enabled = 0`; the route then returns **404** (not 403 —
  a 403 confirms the token existed).
- Rotating generates a new token and invalidates the old one immediately, with
  a warning that previously imported Bring! entries will no longer link back.
- The recipe list shows which recipes currently have a public link, so a
  forgotten open link is visible at a glance.

### 8.3 Route: `GET /r/:token`

- No session required. No cookies set. No session middleware on this route.
- Response headers: `X-Robots-Tag: noindex, nofollow`,
  `Referrer-Policy: no-referrer`, `Cache-Control: public, max-age=300`.
- Also emits `<meta name="robots" content="noindex,nofollow">`.
- Accepts `?yield=N` and renders the recipe **already scaled to N**.
- Rate limit: generous (e.g. 60 requests/minute/IP) — tight enough to stop
  token brute-forcing, loose enough that Bring's fetchers are never blocked.
  A 32-byte token is not brute-forceable anyway; the limit protects the Pi's
  CPU, not the secret.
- The page contains **only** the recipe: no navigation into the app, no user
  name, no links to other recipes, no login form. Since v1.1 that "only" is
  narrower still — see §8.4.

### 8.4 Markup for the parser

Emit **JSON-LD** (`<script type="application/ld+json">`) — it is the format
Google and every modern importer prefer — **and** matching microdata
attributes (`itemprop`) in the visible HTML, since Bring's documented example
is microdata-based. Both describing the same, already-scaled values.

Since v1.1 the share page carries only the name, the servings and the
ingredients — Bring! only ever reads `recipeIngredient` to build a shopping
list, and the method is for the cook, not the public internet (this is the
one route exposed to it). There is no `recipeInstructions`, and no
`recipeCategory`, `totalTime`, `prepTime`, `cookTime`, `description` or
`image` either, since the recipe model no longer carries any of them (§5).

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "...",
  "recipeYield": "6 servings",                 // the REQUESTED yield
  "recipeIngredient": [
    "250 g Mehl",                              // one flat string per ingredient
    "2 Eier"
  ]
}
```

Ingredient strings are built as `amount unit name` in that order, in the
recipe's content language. Ingredients with `exclude_from_shopping = 1` are
**omitted** from `recipeIngredient` but still shown in the visible HTML —
this is how "water" and "salt" stay out of the shopping list. The column and
this builder behaviour remain even though the editor has no UI to set the
flag (§2.1 A2, §13 criterion 6).

### 8.5 The deeplink, and the double-scaling trap

Button on the (logged-in) recipe page:

```
https://api.getbring.com/rest/bringrecipes/deeplink
  ?url=<urlencoded PUBLIC_BASE_URL/r/TOKEN?yield=N>
  &source=web
  &baseQuantity=N
  &requestedQuantity=N
```

**`baseQuantity` and `requestedQuantity` must be identical** and must equal the
yield the share page was rendered with. Bring multiplies by
`requestedQuantity / baseQuantity`; since our page already delivers scaled
amounts, the factor must be exactly `1.0`. Sending `baseQuantity=4` with
`requestedQuantity=8` against an already-doubled page produces a shopping list
for sixteen people. This must be covered by a test.

Behaviour details:
- The endpoint answers with `307` to an app deeplink, so a plain `<a href>` is
  correct — do **not** fetch it with JavaScript.
- Include the yield in the share URL so that the "back to recipe" link stored
  inside Bring! reopens the recipe at the same quantity, and so that Bring's
  per-URL caching does not serve a stale quantity.
- If sharing is disabled for the recipe, the Bring! button is replaced by a
  one-click "Enable public link and send to Bring!" action that explains, in
  one sentence, that Bring! needs to fetch the recipe itself.

### 8.6 Other importers

No extra work: the same JSON-LD makes the share URL importable by Mealie,
Tandoor, Paprika, AnyList and Samsung Food. Document this in the README rather
than building integrations.

### 8.7 Other exports

- **Copy ingredients as text** — clipboard, one ingredient per line, at the
  currently selected yield, respecting `exclude_from_shopping`.
- **JSON export** — `GET /recipes/:id/export.json` (authenticated) and
  `GET /export/all.json` for a full backup of the user's own recipes. Format:
  the app's own schema, versioned with `"formatVersion": 1`, importable via
  `POST /import` (see §12 milestones — import is phase 3).
- **Print view** — `?print=1` or a dedicated print stylesheet: recipe at the
  chosen yield including the method, no navigation, no buttons,
  page-break-safe. Unlike the share page (§8.4), the print view is
  authenticated and includes the method — it's for the cook, not for Bring!.

---

## 9. Routes

Authenticated unless marked public.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Recipe list (own + shared), search (title, ingredient name), sort |
| GET | `/login`, POST `/login` | *public* |
| GET | `/register`, POST `/register` | *public*, invite code required |
| POST | `/logout` | |
| GET | `/recipes/new`, POST `/recipes` | Create |
| GET | `/recipes/:id` | View (`?yield=N`, `?print=1`) |
| GET | `/recipes/:id/edit`, POST `/recipes/:id` | Edit |
| POST | `/recipes/:id/delete` | Soft-delete → archive; hard delete from archive |
| POST | `/recipes/:id/duplicate` | |
| POST | `/recipes/:id/share/link` | Enable / rotate / disable public token |
| POST | `/recipes/:id/share/user` | Grant/revoke access for a user |
| GET | `/recipes/:id/export.json` | |
| GET | `/export/all.json` | |
| GET | `/r/:token` | **public** share page (§8.3) |
| GET | `/uploads/:file` | **public** images — only reachable via unguessable filename. `image_path` is always `NULL` in v1.1 (§5), so this route is currently unused, kept for when images come back |
| GET | `/account`, POST `/account/password` | |
| GET | `/admin/invites`, POST `/admin/invites` | admin only |
| GET | `/healthz` | **public**, returns 200 + version, for Uptime Kuma |

`/healthz` must not touch the database beyond a trivial `SELECT 1`, and must
never leak version details of dependencies.

---

## 10. User interface

Mobile-first. The primary usage context is a phone on a kitchen counter with
wet hands.

### 10.1 Pages

- **List** — cards or compact rows: title. Search box (title, ingredient
  name). Sort by recently added / title / last cooked. Empty state that
  links straight to "New recipe".
- **Recipe** — title, meta line (yield), yield control, ingredients (flat
  list, with checkboxes that survive scrolling), method (shown exactly as
  typed, line breaks preserved). Action bar: **Send to Bring!**, copy,
  print, edit.
- **Editor** — one page, no wizard. Ingredient rows: amount, unit (the
  fixed dropdown, §7.2), name — add or remove a row, no drag reordering, no
  quick-add line, no per-row toggles. Method is a single, optional
  textarea, stored and shown exactly as typed. Autosave draft to
  `localStorage` so a dropped connection never loses a half-typed recipe.
- **Share page** — recipe only, stripped down further than the app view:
  name, servings and ingredients only, no method (§8.4).

### 10.2 Design

- Follow the ProjectIndex convention: **all visual parameters in
  `css/tokens.css`** (colors, fonts, type scale, spacing, radii), with
  `style.css` reading only tokens. Restyling must not require touching
  components.
- Dark mode default from `prefers-color-scheme`, manual toggle persisted in
  `localStorage`, applied before first paint to avoid a flash (same
  `theme-init.js` trick as ProjectIndex).
- Visually consistent with ahultsch.com — minimal, calm, developer aesthetic —
  but warmer: this one is a cookbook, not a terminal. One accent color.
- Large tap targets (min 44 px), readable body text (min 16 px), high
  contrast. A "keep screen awake" toggle on the recipe page using the Wake Lock
  API where available, degrading silently where not.
- No third-party scripts, no fonts loaded from a CDN, no analytics.

---

## 11. Security

The app is internet-facing behind Cloudflare and Caddy. Threat model: an
opportunistic scanner, and anyone who ends up holding a share link.

- `helmet` with a strict **Content-Security-Policy**: `default-src 'self'`,
  no inline scripts (use nonces or external files), `img-src 'self' data:`.
  The Bring! button is a plain link, so no external script is needed.
- **CSRF tokens** on every state-changing POST (double-submit cookie or
  `csrf-csrf`). The public share route has no forms and needs none.
- `trust proxy` set correctly, otherwise every rate limit sees Caddy's IP and
  becomes useless.
- Rate limits: login (§6.1), registration, share route (§8.3), and a global
  ceiling.
- Input validation with `zod` on every route; reject rather than coerce.
- Output escaping by default in EJS (`<%= %>`, never `<%- %>` for user data).
  Recipe text is **plain text, not HTML/Markdown** — this removes an entire
  class of XSS. If Markdown is ever wanted for steps, it must be rendered
  through a sanitizer, and that is a separate decision.
- Uploads: images only, verified by magic bytes not by extension, hard size
  cap (5 MB), re-encoded via `sharp` (which also strips EXIF/GPS), stored
  under a random filename, served with `Content-Disposition: inline` and
  `X-Content-Type-Options: nosniff`.
- SQL exclusively through prepared statements.
- No secrets in the repo, no secrets in logs, no recipe content in logs.
  Log lines: timestamp, method, path *without* share tokens, status, duration.
  **Share tokens must be redacted from access logs** — a log file is not a
  place for a capability URL.
- Container runs as a non-root user; `no-new-privileges`; read-only root
  filesystem except the mounted `/data`.
- Dependencies pinned; `npm audit` clean at release; no `latest` image tags,
  per the Pi repo's rule.

---

## 12. Deployment

### 12.1 Container

- Multi-stage `Dockerfile` on `node:24-alpine`, `npm ci --omit=dev`,
  non-root `USER node`, `EXPOSE 3000`, `CMD ["node", "server.js"]`,
  `HEALTHCHECK` hitting `/healthz`.
- Must build on **linux/arm64**. Native modules (`better-sqlite3`, `sharp`,
  `argon2`) need build tooling in the build stage only — verify the final
  image does not ship a compiler.
- Migrations run automatically at startup before the server listens, and are
  idempotent.

### 12.2 On the Pi

Compose service (to be added to `PiMultiServiceServer/docker-compose.yml`):

```yaml
dishlist:
  build: ./apps/dishlist
  restart: unless-stopped
  env_file: ./apps/dishlist/.env
  volumes:
    - ./data/dishlist:/app/data
  networks: [edge]
```

Caddyfile block:

```
@dishlist host dishlist.{$DOMAIN}
handle @dishlist {
    reverse_proxy dishlist:3000
}
```

Then: a `sites.conf` entry with `admin yes` (so the shared admin credentials
are seeded), a Cloudflare Published Application route
`dishlist.<domain> → http://caddy:80`, and an Uptime Kuma monitor on
`https://dishlist.<domain>/healthz`.

The Pi's nightly backup already covers `data/`, so the SQLite file and the
uploads are backed up as soon as they live under `data/dishlist/`. Verify this
explicitly rather than assuming it.

**Cloudflare caution:** if any bot-fighting or Access rule is ever enabled for
this hostname, `/r/*` must be excluded, or Bring! imports will silently break
while the site looks perfectly fine in a browser.

### 12.3 Milestones

| Phase | Content |
| --- | --- |
| **0** | Repo skeleton, Dockerfile, config, migrations, `seed:admin`, `/healthz`, login. Deployable and reachable, nothing else. |
| **1** | Recipe CRUD, list, view — flat ingredient list, single method field. Single user, no scaling yet. |
| **2** | Scaling engine + unit/rounding logic with full unit tests, yield control. |
| **3** | Share tokens, public share page with JSON-LD + microdata, Bring! button. **Verified on a real phone with the real Bring! app before the phase is called done.** |
| **4** | Registration by invite, per-user sharing, account management. |
| **5** | Text/JSON export, print view, JSON import. |

Later, explicitly not in v1: meal planning, weekly plans, "cooked on" history,
recipe import by URL scraping, PWA/offline, shopping-list management inside
Dishlist (Bring! is the shopping list — duplicating it defeats the purpose).

---

## 13. Testing and acceptance

Unit tests (`node:test`) are mandatory for `domain/scaling.js`,
`domain/units.js` and the JSON-LD builder. Route-level tests with
`supertest` for auth and authorization.

Explicit acceptance criteria:

1. A recipe with base yield 4, scaled to 6, shows `375 g` where the base was
   `250 g`, and leaves an ingredient marked `scales = false` untouched.
2. `GET /r/:token` returns 200 with complete JSON-LD **when sent with no
   cookies at all**, and the ingredient strings in it match what the visible
   page shows.
3. `GET /r/:token` returns 404 after sharing is disabled, and after rotation
   the old token also returns 404.
4. Every authenticated route returns 302→`/login` when unauthenticated; every
   recipe route returns 404 for a recipe belonging to another user.
5. The Bring! deeplink built for yield 6 carries `baseQuantity=6` and
   `requestedQuantity=6` and a URL-encoded share URL containing `yield=6`.
6. Ingredients with `exclude_from_shopping = 1` appear on the page but not in
   `recipeIngredient`. The editor has no UI to set this flag any more (§2.1
   A2) — the column and the builder behaviour it drives are retained, so
   this criterion is verified at the repository/builder level, not through
   the editor.
7. `docker build` succeeds for `linux/arm64` and the container starts with only
   the variables from `.env.example` set.
8. **Manual, non-negotiable:** a real import into the real Bring! app on a real
   phone yields the correct items at the correct quantities.

---

## 14. Documentation to be produced

- `README.md` — what it is, how to run locally, how to deploy on the Pi, how
  the Bring! integration works and why the share page must be public.
- `CLAUDE.md` — working rules for Claude Code: this spec is the source of
  truth; domain logic stays pure and shared between server and client; SQL only
  in repositories; never log share tokens; never commit `.env`; every scaling
  or unit change needs a test.
- `.env.example` — every variable from §3.1.

---

## 15. Security summary

- One deliberately public route (`/r/:token`) plus `/healthz`, `/login`,
  `/register` and `/uploads/:file`; everything else requires a session.
- Capability URLs with 256 bits of entropy, revocable and rotatable per
  recipe, off by default, listed in the UI so nothing is forgotten.
- No email, no password reset by mail, no third-party scripts, no tracking.
- Secrets only from the environment; public repository assumed at all times.

---

## 16. Open questions for Alex

1. ~~Confirm assumptions A1–A4 in §2.1~~ — **Answered in v1.1.** §2.1 now
   states the decided model directly: structured `amount | unit | name`
   only, no per-ingredient `scales`/`exclude_from_shopping` UI, numeric
   servings with no unit choice, and no ingredient groups.
2. Recipe content language: German content in an English UI — confirm that
   date/number formatting should follow `de-DE` (§7.3). Bring's catalog
   matching also works best when ingredient names are in one consistent
   language.
3. Subdomain: `dishlist.ahultsch.com`, or something more cookbook-like?
4. Should shared users be able to *edit*, or only read? (`can_edit` exists in
   the schema either way.)
5. ~~Images: worth the `sharp`/upload complexity in v1, or defer to phase 5
   as planned here?~~ — **Answered in v1.1.** Images are out of the recipe
   model entirely for now (§5); `image_path` stays dormant. Revisit by
   adding an image field back later, not by a schema change.
6. Anything from §12.3 "explicitly not in v1" that you actually want early?
