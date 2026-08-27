# Dishlist — Specification v2.0

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

## Changes in v2.0

v1 was a private cookbook with capability links: every recipe lived only for
its owner and, at most, the individual users it had been explicitly shared
with. v2 adds a second space alongside "My Dishes": a **Public** shelf, a
community gallery that any logged-in user can browse and search, listing a
recipe's name and its author's username. The unguessable `/r/<token>` URL
stops being how humans find a recipe — that job now belongs to the shelf —
and becomes purely the machine channel Bring! reads.

This is a genuine shift, not an addition bolted onto the private cookbook, so
it touches authorization, the data model, navigation, the servings control,
one unit label, and adds an import counter with its own anti-cheat design.
The full set of decisions:

- **Public shelf, behind login (D1).** A new `is_public` flag per recipe. A
  public recipe is listed for every logged-in user; anonymous visitors get
  nothing new — the internet-facing surface is still exactly `/r/<token>`,
  `/healthz`, `/login` and `/register` (§1 principle 3, restated below, not
  removed). Publishing a recipe **also** turns on its `/r/<token>` link,
  because Bring! can only import from a URL its own servers can fetch — this
  consequence is spelled out at the point of publishing, not left implicit
  (§10, §11).
- **Authorization, simplified (D2).** Read = owner or public. Write = owner,
  full stop — shared per-user editing is gone. Anyone who can read a recipe
  can duplicate it into a private copy of their own, with no share token and
  no import count. `recipe_shares` becomes dormant, like the v1.1 dormant
  columns (§5.1 replaces the old rule entirely).
- **Admin acts without reading (D3).** An admin screen lists recipes by
  title, author, public/private state, created date and import count, and
  can unpublish or delete a recipe, or delete a user (cascading to their
  recipes) — but never displays ingredients or method. Moderation needs
  identity and existence, not contents.
- **The Bring! import counter (D4).** The "Send to Bring!" button now goes
  through `GET /recipes/:id/bring?yield=N`, which records the import and
  redirects 302 to the Bring! deeplink — still a plain server-side redirect,
  never fetched by JavaScript (§8.5 unchanged in that respect). A first-party
  `dishlist.did` device cookie plus a `bring_imports` table cap the count at
  once per device per day; `recipes.bring_import_count` is the denormalised
  total. The metric is inflatable and that is accepted (§8.5, §11).
- **Navigation rebuilt around the two shelves (D5).** A three-item bottom
  nav (My Dishes / Public / + New), a burger menu (Account, Privacy, Report
  a bug, Log out) that now also holds the archive, title-first search with
  ingredient search as a secondary toggle, alphabetical default sort with an
  A–Z rail, import count on cards instead of servings (author too, on
  Public cards only), a collapsed public-link section, and a new Privacy
  page (§10).
- **Servings control constrained (D6).** The free-form yield control is
  replaced by a snap-scroll wheel of integers 1–10, default 4. The scaling
  engine (§7.1–7.3) does not change, only the control that drives it — this
  costs the ability to scale to 12 from the UI, and that trade-off is
  accepted (§7.4).
- **One label change (D7).** The `stueck` unit now displays as "pcs" instead
  of "Stück"; no key is renamed (§7.2).

Phases A, B and C (§12.3) deliver this independently: look and navigation,
then the public shelf and admin tools (migration 002), then the import
counter (migration 003). Acceptance criteria 9–15 (§13) cover the new
behaviour; criteria 1–8 are unchanged.

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
   other route requires a session. This still holds in v2: the public
   *shelf* (D1, §10) is a gallery for logged-in users, not a public route —
   an anonymous visitor reaches nothing new. The internet-facing surface
   remains exactly `/r/<token>`, `/healthz`, `/login` and `/register`.
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
| Recipe visibility | **Private by default. Since v2.0**, an owner may publish a recipe to the **Public shelf** (D1, §5.1), visible and searchable to any logged-in user; per-user sharing (`recipe_shares`) is dormant, superseded by the shelf. |
| Public share link | **Permanent random token per recipe, off by default, toggleable and revocable per recipe. Since v2.0**, publishing to the Public shelf also enables the token, because Bring! can only import from a URL it can fetch (§10, §11) — un-publishing does not retract a token already held; rotating does. |
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

`docs/design/` holds the approved visual mockups (§10); `src/views/partials/icons.ejs` holds the icon sprite (§10.D).

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

**Additions — migration 002 (Phase B, D1/D2/D3):** columns added to
`recipes`, `001_init.sql` left untouched.

```sql
-- migration 002
ALTER TABLE recipes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
```

`recipe_shares` (including its `can_edit` column) receives no migration —
the table stays exactly as `001_init.sql` created it, unused (§5.1).

**Additions — migration 003 (Phase C, D4):** the Bring! import counter.

```sql
-- migration 003
ALTER TABLE recipes ADD COLUMN bring_import_count INTEGER NOT NULL DEFAULT 0;

bring_imports (
  recipe_id -> recipes.id ON DELETE CASCADE,
  device_id TEXT NOT NULL,               -- from the dishlist.did cookie
  day TEXT NOT NULL,                     -- YYYY-MM-DD, UTC date (the daily boundary is not local midnight)
  PRIMARY KEY(recipe_id, device_id, day)
)
```

A repeat `GET /recipes/:id/bring` from the same device on the same day is an
`INSERT OR IGNORE` into `bring_imports` — a no-op that still redirects, but
only increments `recipes.bring_import_count` when the insert actually wrote
a row. `bring_import_count` is a denormalised total kept alongside the exact
table so the recipe list can sort and filter on it cheaply, without a join
and a `COUNT` on every page render.

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
- **Since v2.0:** `recipe_shares` (and its `can_edit` column) is dormant —
  the table stays, nothing writes to it any more. Per-user sharing is
  superseded by the Public shelf (D2, §5.1).

Any of this can come back later by adding a form field, not by changing the
schema.

### 5.1 Authorization rules — replaces the v1 rules (D2)

```
read      = the acting user owns the recipe, OR recipes.is_public = 1
write     = the acting user owns the recipe. Only the author edits. Full stop.
duplicate = anyone who can read a recipe may duplicate it. The copy belongs
            to the duplicating user, is private (is_public = 0), and carries
            NO share token and NO import count.
delete    = the owner, or an admin (§6.4 / D3).
```

Per-user sharing is gone: `recipe_shares` and its `can_edit` column are
dormant (§5), superseded by the Public shelf. There is no longer a
"shared with me, can I edit it" case to check.

Every repository function that loads a recipe still takes the acting user id
and enforces this **in SQL**, not in the route — that rule is unchanged from
v1. The single exception remains the public share route (§8), which loads by
token and by definition has no acting user.

Admins are covered separately (§6.4 / D3): an admin can act on any recipe's
*metadata* (unpublish, delete) through the admin screens, but the ordinary
read/write rules above still govern every non-admin route — an admin has no
implicit read access to another user's recipe contents through `/recipes/:id`.

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

### 6.4 Admin acts without reading — since v2.0 (D3)

`/admin/recipes` lists every recipe by **title, author, public/private
state, created date and import count** — never ingredients, never method.
From that list an admin can:

- **Unpublish** a recipe (`is_public → 0`).
- **Delete** a recipe outright.

`/admin/users` lists users and lets an admin **delete a user**, which
deletes that user's recipes with them via the existing `ON DELETE CASCADE`
(§5). An admin must not be able to delete the last remaining admin account,
nor their own account while it is the last admin — both attempts are
rejected.

Admins gain **no** ability to read recipe contents, public or private, in
these screens or anywhere else. This replaces the v1 wording "admins have no
implicit read access to other users' recipes" but keeps its intent:
moderation needs identity and existence — whose recipe is this, does it
exist, is it published — not the ingredients or the method inside it.

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
| `stueck` | pcs | count |

"No unit" is stored as the `piece` unit (count dimension with empty label), so
`2 Eier` renders without a unit word while still getting the count rounding
rule (§7.3: nearest 0.5, never below 0.5). This is a deliberate internal
representation, not an accident — it lets `piece` (displayed as "2 Eier")
and the `stueck` unit (displayed as "2 pcs Butter") share the count
rounding and conversion rules while differing only in the label shown.
The `stueck` unit was new in v1.1; **since v2.0** (D7) its label is "pcs"
instead of "Stück" — the other labels stay German (TL, EL, Prise) because
ingredient names are German. The key is unchanged, so this is a display-only
change: nothing stored migrates.

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

### 7.4 UI behaviour — servings control rebuilt (D6, since v2.0)

- The recipe page has a yield control: a horizontal snap-scroll wheel of
  **integers 1 to 10**, default 4. The old `−/+` buttons, the `×0.5`/`×2`
  presets and free numeric entry are all **removed**.
- Changing it recalculates ingredient amounts **client-side without a page
  reload**, and updates the URL query (`?yield=6`) via `history.replaceState`
  so the state is linkable and reloadable.
- Server render always honours the `yield` query parameter: `?yield=N` is
  validated to an **integer in 1..10**; anything else (out of range,
  non-numeric, absent) falls back to the recipe's own servings — still never
  a `400`, matching the v1 rule that the share page must never error on a
  malformed yield.
- The scaling engine itself (§7.1–7.3) is unchanged — only the control that
  drives it is constrained. Trade-off, stated explicitly: scaling to, say,
  12 for a party is no longer possible from the UI. The stored `yield_amount`
  on a recipe is not limited to 1–10, only the interactive control is.
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

**Since v2.0 (D4), "Send to Bring!" no longer links straight to Bring.** It
links to our own route:

```
GET /recipes/:id/bring?yield=N
```

which records the import (see "Import counter" below), then answers **`302`**
to the Bring! deeplink:

```
https://api.getbring.com/rest/bringrecipes/deeplink
  ?url=<urlencoded PUBLIC_BASE_URL/r/TOKEN?yield=N>
  &source=web
  &baseQuantity=N
  &requestedQuantity=N
```

This is a server-side redirect: `/recipes/:id/bring` works with JavaScript
disabled (a plain `<a href="/recipes/:id/bring?yield=N">` is correct), and
the rule that the Bring! deeplink itself must never be **fetched** by
JavaScript is untouched — we redirect to it, we do not fetch it.

**`baseQuantity` and `requestedQuantity` must be identical** and must equal
`N`. Bring multiplies by `requestedQuantity / baseQuantity`; since our page
already delivers scaled amounts, the factor must be exactly `1.0`. Sending
`baseQuantity=4` with `requestedQuantity=8` against an already-doubled page
produces a shopping list for sixteen people. This must be covered by a test
— acceptance criterion 5 (§13) is unchanged by the D4 redirect.

Behaviour details:
- Include the yield in the share URL so that the "back to recipe" link stored
  inside Bring! reopens the recipe at the same quantity, and so that Bring's
  per-URL caching does not serve a stale quantity.
- If sharing is disabled for the recipe, `/recipes/:id/bring` enables the
  public link first (as v1 did before handing off to Bring), still
  explaining in one sentence that Bring! needs to fetch the recipe itself.

**Import counter and anti-cheat — since v2.0 (D4).** A first-party cookie
`dishlist.did` identifies a device: 16 random bytes, base64url-encoded,
`httpOnly`, `sameSite=lax`, `secure` in production, long expiry, set by us,
sent to nobody else (this is the one cookie of its kind in the app and is
documented on the Privacy page, §10, §11).

The `bring_imports` table (§5, migration 003) makes a repeat import from the
same device on the same day a no-op:

```sql
INSERT OR IGNORE INTO bring_imports (recipe_id, device_id, day) VALUES (?, ?, ?)
```

The user may tap "Send to Bring!" as often as they like; the counter moves
once per device per day, and `recipes.bring_import_count` is incremented
only when the insert actually wrote a new row. This makes the metric
**inflatable** — a determined user can run up the count with several
devices, or by asking friends — and that is accepted: it is a rough quality
signal for sorting and filtering the shelf, not a measurement to be defended
against abuse.

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
  `POST /import` (see §12 milestones).
- **Print view** — `?print=1` or a dedicated print stylesheet: recipe at the
  chosen yield including the method, no navigation, no buttons,
  page-break-safe. Unlike the share page (§8.4), the print view is
  authenticated and includes the method — it's for the cook, not for Bring!.

---

## 9. Routes

Authenticated unless marked public.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | "My Dishes" — own recipes, search (title-first, ingredient toggle), alphabetical sort by default (§10) |
| GET | `/public` | **since v2.0** — Public shelf: every `is_public = 1` recipe, name + author, searchable by every logged-in user (D1) |
| GET | `/archive` | **since v2.0** — archived recipes (own only), moved out of the main flow into the burger menu (D5) |
| GET | `/login`, POST `/login` | *public* |
| GET | `/register`, POST `/register` | *public*, invite code required |
| POST | `/logout` | |
| GET | `/recipes/new`, POST `/recipes` | Create |
| GET | `/recipes/:id` | View (`?yield=N`, `?print=1`) |
| GET | `/recipes/:id/edit`, POST `/recipes/:id` | Edit — owner only (D2); 404 for anyone else, including on a public recipe |
| POST | `/recipes/:id/delete` | Soft-delete → archive; hard delete from archive. Owner only — an admin deletes through `/admin/recipes/:id/delete` instead (D2, D3) |
| POST | `/recipes/:id/duplicate` | **since v2.0** — anyone who can read the recipe (owner or public, D2); copy is private, no share token, import count 0 |
| POST | `/recipes/:id/publish` | **since v2.0** — toggle `is_public` (D1); enabling also enables the share token (§8.2, §10) |
| POST | `/recipes/:id/share/link` | Enable / rotate / disable public token |
| GET | `/recipes/:id/bring` | **since v2.0** — records a Bring! import, `302`s to the deeplink (§8.5, D4) |
| GET | `/recipes/:id/export.json` | |
| GET | `/export/all.json` | |
| GET | `/r/:token` | **public** share page (§8.3) |
| GET | `/uploads/:file` | **public** images — only reachable via unguessable filename. `image_path` is always `NULL` in v1.1 (§5), so this route is currently unused, kept for when images come back |
| GET | `/account`, POST `/account/password` | |
| GET | `/privacy` | **since v2.0** — Privacy page: documents the `dishlist.did` cookie and nothing else tracked (D5, D4, §11) |
| GET | `/admin/invites`, POST `/admin/invites` | admin only |
| GET | `/admin/recipes` | **since v2.0** — admin only. Title, author, public/private, created date, import count; unpublish, delete (D3) |
| POST | `/admin/recipes/:id/unpublish`, POST `/admin/recipes/:id/delete` | **since v2.0** — admin only (D3) |
| GET | `/admin/users`, POST `/admin/users/:id/delete` | **since v2.0** — admin only; cannot delete the last remaining admin, nor self while the last admin (D3) |
| GET | `/healthz` | **public**, returns 200 + version, for Uptime Kuma |

The `POST /recipes/:id/share/user` route from v1 (grant/revoke per-user
access) is removed: `recipe_shares` is dormant (D2, §5.1), superseded by
`/recipes/:id/publish`.

`/healthz` must not touch the database beyond a trivial `SELECT 1`, and must
never leak version details of dependencies.

---

## 10. User interface — navigation rebuilt for the shelf (D5, since v2.0)

**Mobile-first, restated as binding.** The primary usage context is a phone
on a kitchen counter with wet hands. Minimum 44 px tap targets, minimum 16 px
body text, high contrast — unchanged from v1, and still non-negotiable.

### 10.0 Navigation

- **Bottom navigation bar**, thumb-reachable, exactly three items: **My
  Dishes**, **Public**, **+ New**. This also supplies the way back from a
  recipe to a list — a gap v1.1 had, since it removed navigation along with
  everything else that wasn't essential.
- **Burger menu**, top right: Account, Privacy, Report a bug, Log out.
- The **archive moves into the burger menu**, out of the main flow — it was
  reachable from the list in v1, it is a deliberate extra step now.

### 10.1 Pages

- **My Dishes / Public** — cards: title and **import count**
  (`bring_import_count`) — no longer the servings; it isn't interesting at a
  glance (D5). **Public** cards also show the **author** as `@username`; My
  Dishes omits it, since every dish listed there is by definition the
  signed-in user's own (§10.E). Search box is **title-first**; ingredient search is a
  secondary toggle beside it, not the default — finding a dish by name is
  the common case, ingredient search is occasional, and the control reflects
  that. **Default sort is alphabetical**, with an **A–Z rail** down the edge
  to jump to a letter. Empty state on My Dishes links straight to
  "New recipe"; empty state on Public explains that no recipes have been
  published yet. Public is listed by every logged-in user; a recipe's
  presence there requires no ownership check beyond `is_public = 1` (D2).
- **Recipe** — title, meta line, yield control (the 1–10 wheel, §7.4),
  ingredients (flat list, with checkboxes that survive scrolling), method
  (rendered exactly as typed, one block per typed line, with a hanging
  indent so a wrapped line aligns under the text rather than under any
  number the user typed — the app still adds no numbering of its own).
  **"Send to Bring!" is the
  primary action** and is styled as the one obvious thing to do on the page;
  copy, print and edit are secondary. Edit is shown only to the owner (D2).
  The **public-link section is collapsed by default** to a single line
  showing only whether the link is on. Expanding it reveals the URL, Copy,
  Rotate and Disable — the URL itself is not on screen until asked for. The
  publish control states, in one sentence, that publishing also enables this
  link because Bring! can only fetch a URL it can reach (D1, §8.2).
- **Editor** — one page, no wizard. Ingredient rows: amount, unit (the
  fixed dropdown, §7.2), name — add or remove a row, no drag reordering, no
  quick-add line, no per-row toggles. Method is a single, optional
  textarea, stored and shown exactly as typed. Autosave draft to
  `localStorage` so a dropped connection never loses a half-typed recipe.
- **Share page** — recipe only, stripped down further than the app view:
  name, servings and ingredients only, no method (§8.4).
- **Privacy** — new, since v2.0. Documents the `dishlist.did` device cookie
  (§8.5, §11) as the one cookie of its kind in the app, and states plainly
  that there is no third-party tracking or analytics (§11).
- **Report a bug** — new, since v2.0. A link in the burger menu pointing at
  the GitHub issue tracker of this repository. There is no in-app bug form:
  that would need storage and a queue nobody reads, and there is no mail
  server (§6.3) to notify anyone either.
- **Admin** — `/admin/recipes` and `/admin/users` (§6.4, D3): plain lists,
  metadata only, no recipe content.

### 10.A The theming contract

The approved v2.0 mockups (`docs/design/v2-mockups.png`) are written into
this document as a binding contract, not just a picture, because Alex's
explicit requirement is that the app must be easy to re-theme later —
"easily change symbols, colors, etc." — without touching component code:

- **Every colour, font, size, spacing, radius and shadow is a CSS custom
  property in `public/css/tokens.css`.** `public/css/style.css` and every
  template read **only** `var(--…)` — no literal hex, no literal font name,
  no magic pixel value anywhere outside `tokens.css`. This already holds
  (§4.1) and must continue to.
- **Every icon is a `<symbol>` in one file, `src/views/partials/icons.ejs`**,
  rendered wherever it is used as `<svg class="icon"><use
  href="#i-name"></use></svg>`.
- Therefore: changing the whole colour scheme is a one-file edit; changing
  any icon is a one-symbol edit in one file. Neither requires touching a
  component or a route.

### 10.B Colour tokens

Exact values from the approved mockup:

| Token | Dark (default) | Light |
| --- | --- | --- |
| background | `#0F1113` | `#FAFAF8` |
| surface | `#181B1E` | `#FFFFFF` |
| surface-2 | `#23272B` | `#F1F3F5` |
| text-primary | `#E8ECEF` | `#0D0F11` |
| text-secondary | `#A6ACB3` | `#4B535C` |
| accent | `#6BCB77` | `#2E7D32` |
| divider | `#2E343A` | `#E3E6EA` |

A **danger** token is also required — the mockup shows "Disable" and
"Log out" in red — but the mockup does not give its hex. It must be defined
as a token in both themes and chosen to meet contrast against `surface`;
the specific hex is an implementation choice, recorded in `tokens.css` when
picked, not invented here.

Dark is the default: `prefers-color-scheme` decides which set applies, and
an explicit `[data-theme]` attribute on the root overrides it in both
directions — the existing mechanism, unchanged. The existing manual-toggle
behaviour is also unchanged: a toggle persists the user's choice to
`localStorage` as the `data-theme` attribute, applied before first paint
(the `theme-init.js` trick) so there is no flash of the wrong theme.

### 10.C Type scale

| Style | Size / line-height | Weight | Notes |
| --- | --- | --- | --- |
| Title | 24 / 32 | Bold | |
| Section heading | 18 / 24 | Semibold | rendered in the accent colour |
| Body | 16 / 24 | Regular | the minimum body size (§10.F) |
| Secondary | 14 / 20 | Regular | |
| Caption | 12 / 16 | Regular | |

The mockup names SF Pro as the typeface. The app loads no webfont: the CSP
(§11) is `default-src 'self'` with no font-host exception carved out, so an
external font could not load even if one were referenced. The font stack is
therefore the system UI font (`-apple-system, BlinkMacSystemFont,
'Segoe UI', Roboto, sans-serif` or equivalent) — which **is** SF Pro on
iOS/macOS, and the platform-native equivalent everywhere else.

### 10.D Icons

The icon set the mockups use, each a `<symbol id="i-…">` in
`src/views/partials/icons.ejs`:

`i-search`, `i-back`, `i-menu`, `i-close`, `i-chevron-right`,
`i-chevron-up`, `i-book` (My Dishes), `i-people` (Public), `i-plus` (New),
`i-bring` (the import mark), `i-globe` (public link), `i-copy`, `i-rotate`,
`i-disable`, `i-account`, `i-privacy`, `i-bug`, `i-archive`, `i-logout`,
`i-filter`.

The sprite is **inlined into every page**, not linked as an external `.svg`
referenced by URL: Safari on iOS does not reliably support `<use>` pointing
at an external file, and the primary device for this app is a phone. Icons
take their colour from `currentColor`, never a hard-coded `fill` — so an
icon always follows the token colouring the text around it, and never needs
a separate colour kept in sync.

`i-bring` — the mark shown next to every import count and on the "Send to
Bring!" button — is a leaf with an arrow, per the mockup: natural,
movement, deliberately not a shopping-cart cliché.

### 10.E Screen anatomy

One paragraph per screen, matching the mockup:

1. **My Dishes** — a search field with a secondary "ingredients" toggle
   beside it, off by default. Rows are sorted A–Z with letter section
   headers, and an A–Z rail runs down the right edge (starting with `#`)
   that jumps to a section. Each row shows the dish name as body text and
   the import count with the `i-bring` mark, above the bottom nav.
   **Deliberate deviation from the mockup:** the mockup also shows an
   author name under each dish on this screen, but on My Dishes every dish
   is by definition the signed-in user's own, so the author line is
   omitted here and shown only on the Public shelf (§10.1).
2. **Recipe** — a back arrow and a burger control in the header, the
   title, a "Servings" section with the 1–10 integer wheel and the current
   value marked, then "Ingredients (for N servings)" where N is the
   selected servings, the ingredient list, the primary "Send to Bring!"
   button, the collapsed public-link row, then "Method".
3. **Public** — laid out as My Dishes, except each row also shows the
   author as `@username`, and the header carries a sort control ("Most
   imported" / A–Z / "Recently added") in place of the ingredients toggle
   alone.
4. **Burger** — a panel over the page from the right, with a close control
   and the items Account, Privacy, Report a bug, Archive, Log out. Log out
   and other destructive items use the `danger` token (§10.B).

**Bottom nav** — three items, always present on list and recipe screens:
My Dishes, Public, and New. New is visually raised as the primary action.
This is also the way back from a recipe to a list.

### 10.F Rules that survive

Restated, not weakened:

- Mobile-first.
- Minimum 44 px tap targets, minimum 16 px body text, high contrast. A
  "keep screen awake" toggle on the Recipe page using the Wake Lock API
  where available, degrading silently where not.
- No inline scripts anywhere, so the CSP (§11) needs no nonces and gets
  none.
- No webfonts, no third-party scripts, no analytics.
- All client JS ships as external files under `public/js/`.

---

## 11. Security

The app is internet-facing behind Cloudflare and Caddy. Threat model: an
opportunistic scanner, and anyone who ends up holding a share link.

- **Publishing consequence (D1, since v2.0):** publishing a recipe to the
  Public shelf also enables its `/r/<token>` share link — Bring!'s servers
  can only import from a URL they can fetch, so "visible to logged-in
  users" unavoidably also means "readable by anyone holding the token".
  Tokens are unguessable (§8.2, 256 bits), but un-publishing does not
  retract a token someone already has — rotating it does. This is stated to
  the user at the point of publishing (§10), not only here.
- **Device cookie (D4, since v2.0):** `dishlist.did` identifies a device for
  the Bring! import counter (§8.5) — 16 random bytes, base64url, `httpOnly`,
  `sameSite=lax`, `secure` in production, long expiry, set by us, sent to
  nobody else. It is the only cookie of its kind in the app, does not
  identify a person, and is documented on the Privacy page (§10). It does
  not conflict with "no third-party scripts, no analytics" above — it is
  first-party, server-set, and used for nothing but the once-per-device-
  per-day import cap.
- `helmet` with a strict **Content-Security-Policy**: `default-src 'self'`,
  `script-src 'self'` with all client JavaScript as external files under
  `public/js/` and no inline scripts anywhere (therefore no nonces needed
  and none permitted), and `img-src 'self' data:`. The Bring! button is a
  plain link, so no external script is needed.
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
| **A** | *v2.0.* Look and navigation: the D5 restyle and navigation (bottom nav, burger menu, archive moved, title-first search, alphabetical sort + A–Z rail), the D6 servings wheel, the D7 `stueck` → "pcs" label. **No schema change.** |
| **B** | *v2.0.* Public shelf and admin: `is_public`, the `/public` gallery, author on cards, duplicate-from-public, the D2 authorization change, the D3 admin screens (`/admin/recipes`, `/admin/users`), delete users. **Migration 002.** |
| **C** | *v2.0.* Import counter: D4 in full (`/recipes/:id/bring`, `dishlist.did`, `bring_imports`), sorting and filtering by import count, the Privacy page. **Migration 003.** |

Each of A, B and C is independently deployable. Phases 0–3 above are the
record of what shipped to get here; they are not revised by A/B/C.

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

**Since v2.0 (D9), added onward — criteria 1–8 above are unchanged:**

9.  A recipe with `is_public = 0` is absent from the public gallery for a
    second logged-in user, and `GET` of it returns 404 for them.
10. A public recipe is visible in the gallery to a second logged-in user,
    who can duplicate it, and whose copy is private, has no share token and
    an import count of zero.
11. A second logged-in user cannot edit a public recipe they do not own:
    the edit route answers 404.
12. Two `GET`s of `/recipes/:id/bring` from the **same device** on the
    **same day** increment `bring_import_count` by exactly one, and both
    answer 302 to a deeplink whose `baseQuantity` equals its
    `requestedQuantity`.
13. The same request from a different device id increments it again.
14. No admin screen response contains any ingredient name or method text of
    a recipe the admin does not own.
15. The anonymous internet still reaches only `/r/<token>`, `/healthz`,
    `/login` and `/register`; the gallery (`/public`) answers 302 to
    `/login` without a session.

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
  `/register` and `/uploads/:file`; everything else — including the Public
  shelf (`/public`) added in v2.0 — requires a session (§1 principle 3, D1).
- Capability URLs with 256 bits of entropy, revocable and rotatable per
  recipe, off by default, listed in the UI so nothing is forgotten.
  **Since v2.0:** publishing a recipe to the shelf also turns the token on;
  un-publishing does not retract a token already held, only rotation does
  (D1, §8.2, §11).
- No email, no password reset by mail, no third-party scripts, no
  third-party tracking or analytics. **Since v2.0:** one first-party,
  functional cookie, `dishlist.did`, exists solely to cap the Bring! import
  counter at once per device per day (D4, §8.5, §11) and is documented on
  the Privacy page (§10).
- Admins can act on recipe and user *metadata* (§6.4, D3) but never read
  recipe contents, public or private.
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
4. ~~Should shared users be able to *edit*, or only read? (`can_edit` exists
   in the schema either way.)~~ — **Answered in v2.0.** Superseded, not
   answered as asked: per-user sharing is gone. Read = owner or public,
   write = owner only, full stop (D2, §5.1). `can_edit` stays in the schema,
   dormant, on `recipe_shares`.
5. ~~Images: worth the `sharp`/upload complexity in v1, or defer to phase 5
   as planned here?~~ — **Answered in v1.1.** Images are out of the recipe
   model entirely for now (§5); `image_path` stays dormant. Revisit by
   adding an image field back later, not by a schema change.
6. Anything from §12.3 "explicitly not in v1" that you actually want early?
