# Bring2Bring! — Specification v2.8

> **Status:** Concept, pre-implementation. This document is the authoritative
> source of truth for the `Bring2Bring` repository
> (<https://github.com/AlexanderHultsch/Bring2Bring>) and should be committed as
> `SPECIFICATION.md` in its root.
>
> **Context:** Bring2Bring! is a private digital cookbook that runs as its own
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

## Changes in v2.1

v2.0 defined the visual system, but the stylesheet only ever applied part
of it. Three rules in `public/css/style.css` overrode the v2.0 contract on
every screen except the recipe page: the bare `button` element carried the
primary-action look, so every other control had to opt out of it; the
§10.C type scale was scoped to `.recipe-page` instead of the global
heading rules, so every other screen kept the pre-v2 scale; and `.icon`
sized itself in `em`, so a symbol's size followed whatever text sat next
to it instead of a token. v2.1 changes almost nothing about *what* the
design is and a great deal about whether it reaches the screen. One
genuine behaviour change rides along with the fixes: the servings range.
The full set of decisions:

- **Buttons declare their role (E1).** The stylesheet styled the bare
  `button` element with the primary-action appearance, so a control had to
  opt *out* of looking like the primary action. Inverted: the `button`
  element is role-neutral, and the visual belongs to the `.button` class
  and its modifiers (`.button--ghost`, `.button--danger`, and a new
  `.button--icon` for icon-only 44 px square controls). Every button in a
  template names its role.
- **One type scale, all screens (E2).** The §10.C type scale was applied
  only under `.recipe-page`; every other screen used the pre-v2 scale. The
  scale now lives on the global `h1`/`h2`/`h3` rules and the page-scoped
  overrides are removed.
- **Icon size is a token, not an inheritance (E3).** `.icon` sized itself
  in `em`, so an icon's size was decided by whatever text it sat next to.
  Two new tokens (`--icon-size`, `--icon-size-sm`) give §10.D's "one place
  to change a symbol" a matching "one place to change its size".
- **"Recipes", not "My Dishes" (E4).** The bottom-nav label said "My
  Dishes" while the page heading said "Recipes". One word wins:
  **Recipes**. The word "dish" leaves the user interface.
- **The recipe screen is for cooking, not for administering (E5).**
  Publishing controls, the public-link panel and their explanatory prose
  sat between the "Send to Bring!" button and the method. Reading order
  becomes: title → servings → ingredients → Send to Bring! → method →
  Edit and Duplicate → a single collapsed disclosure holding publishing,
  the public link and Archive. Edit and Duplicate stay one tap away
  deliberately; the disclosure holds only what is touched once per recipe
  rather than once per cook.
- **The servings control is a ruler (E6).** Ten integers laid across the
  full width with a tick beneath each and the selection in a filled
  accent circle, replacing a scrolling row of circular buttons. The
  underlying markup — ten `?yield=N` anchors — is unchanged, so it still
  works with JavaScript off.
- **A recipe's own servings are limited to 1–10 (E7).** This **reverses**
  the sentence in §7.4 that reads "The stored `yield_amount` on a recipe
  is not limited to 1–10, only the interactive control is." A ruler shows
  its whole range, so a recipe whose stored servings fall outside that
  range could not be shown at its own size. Servings are now validated as
  an **integer in 1..10** on submit, the same bound the `?yield=`
  parameter already enforces. Existing rows outside the range are
  deliberately **not** migrated: a migration would silently change what a
  stored quantity means. Such a recipe still renders and still scales
  correctly from its true base; the ruler simply shows no selection until
  one is picked, and the next edit surfaces the validation error.

---

## Changes in v2.2

v2.1 made the design reach the screen. v2.2 is about what the interface
*claims* and what it lets you *do with your thumb* — two controls that
were static become things you drag, one control stops claiming to be the
main feature, and one menu that could not be closed can be. The full set
of decisions:

- **"My Recipes", not "Recipes" (F1, partly reverses E4).** v2.1 settled
  on the single word "Recipes" for the user's own shelf. Sitting next to
  the Public shelf, that word reads as *all* recipes, not just the
  signed-in user's own. The screen and its bottom-nav item are now **My
  Recipes**; Public stays Public. This reverses part of E4, it does not
  quietly restate it. The **admin** recipe list (§6.4) is not renamed —
  it lists every user's recipes, and "Recipes" is the correct word there.
- **The wordmark is on every screen (F2).** The header showed either the
  wordmark or a page title, never both, so the admin screens replaced the
  app's name with the word "Admin". The wordmark is now present on every
  screen, larger, and in the accent colour. It is the header's only
  identity; page titles live in the `<h1>`, per E5.
- **New is an ordinary navigation item (F3).** A raised, accent-coloured
  circle is the strongest claim the interface can make, and it was making
  it for *adding* a recipe — something done occasionally. The app exists
  to send an existing recipe to Bring! (§1 principle 1). The bottom
  navigation becomes three equal items — My Recipes, Public, New — with
  the accent used only to mark which one you are on. After this, **"Send
  to Bring!" is the only accent-coloured primary button anywhere in the
  app**, which is the claim the interface should be making.
- **The burger menu must be closable without a keyboard (F4).** It could
  not be. Two defects, and both are recorded, because they are the kind
  that hide behind a plausible-looking implementation: the full-screen
  scrim is a *descendant* of the `<details>` element, so the
  close-on-outside-click handler asked `menu.contains(event.target)`, got
  true for every tap on the scrim, and did nothing; and the scrim is
  `position: fixed; z-index: 30` while the summary that owns it is not
  raised at all, so the close icon — which does swap in correctly — was
  painted over by its own overlay. Escape worked, which is no use on a
  phone. The rule going forward: **the control that opens an overlay must
  remain reachable above it, and closing must never depend on
  JavaScript.**
- **The servings control is a wheel, not a ruler (F5).** v2.1's ruler
  showed all ten values at once and was static. It becomes a
  centre-locked wheel: a fixed lens at the middle of the strip, the
  numbers scroll under it, and whatever is in the lens is the selection.
  Momentum is deliberate — a flick travels several numbers and settles on
  the nearest. Stated honestly, the trade-off: momentum can overshoot,
  which §1 principle 5 ("a wrong quantity is worse than no export") makes
  worth recording. It is acceptable because the ingredient amounts and
  the "for N servings" heading update live as the wheel moves, and the
  Bring! deeplink is built server-side from the same value, so a wrong
  quantity is always **visible before it is sent, never sent silently**.
  Tapping a number still selects it, and the ten `?yield=N` anchors
  remain.
- **The A–Z rail is dragged, not read (F6).** All 27 letters at caption
  size on a phone are too small to read and too small to hit. They stop
  being something you read: dragging along the rail magnifies the letter
  under your finger into a bubble that tracks the finger, and the list
  jumps to that section when the finger lifts — scrolling the document
  mid-gesture makes the browser cancel the pointer, which would end the
  drag, so the jump is deferred to release — letters with no recipes stay
  dim and do not jump, and scrolling the list brightens the letter you are
  currently in. Every letter remains a real anchor.

F5 and F6 both rest on the same **progressive enhancement rule**: both
are enhancements over markup that already works. With JavaScript off, the
wheel is a tappable row of `?yield=N` links and the rail is a column of
`#sect-X` anchors. Neither interaction may become the only way to reach a
value — the same rule §7.4 already states for the yield control, now
stated once for both.

---

## Changes in v2.3

v2.2 finished making the interface match its own rules — look, navigation,
and what could be dragged with a thumb. v2.3 changes what the product is
called. This is a rename of the product, not of what it does: no behaviour
changes, no route changes, no schema changes. The full set of decisions:

- **The product is renamed to Bring2Bring! (G1).** `!` is not legal in a
  GitHub repository name, a Docker Compose service name, a cookie name, or a
  hostname, so the name requires three forms: the **display** form,
  **Bring2Bring!**, used in prose, the wordmark, and page titles; the
  **repository** form, `Bring2Bring`, used for the GitHub repository name and
  its URLs (the other repositories on the same account, `PiMultiServiceServer`
  and `ProjectIndex`, are CamelCase, so the repository takes the display name
  without the `!` rather than the all-lowercase machine form); and the
  **machine** form, `bring2bring`, used wherever the name has to survive
  as a bare token. The machine form carries: the Compose service, the three
  cookies (`bring2bring.sid`, `bring2bring.csrf`, `bring2bring.did`), the
  `localStorage` keys, the SQLite filename and its directory, and the
  `apps/` directory on the Pi. Deliberately left behind: the hostname
  `dishlist.ahultsch.com` and the Cloudflare tunnel route, still deferred by
  the owner — this leaves the app served from a hostname that no longer
  matches its name, and the share links already handed to Bring! point at
  that hostname, which is the reason to change it slowly and separately, not
  an oversight. Three consequences follow: renaming the session cookie forces
  one logout; renaming the device cookie makes every phone read as new, so
  each recipe can be counted once more per device — existing counts are not
  lost, they can tick up by one; and the theme preference and any unsaved
  editor draft held in `localStorage` are orphaned once. The hazard, stated
  as plainly as it was before landing: renaming `DB_PATH` without moving the
  file does not fail — the app starts, migrates against a path that does not
  exist, creates an empty database, and serves a working site with no recipes,
  and every health check passes. The move is an explicit, separate step, taken
  with the container stopped, after a backup.

## Changes in v2.4

v2.3 renamed the product and touched nothing else. v2.4 closes two gaps that
were already on the open list rather than adding anything new — one where the
app could take an action it could not undo, one where a correct-looking date
calculation is wrong for the person using it. The full set of decisions:

- **Archiving is reversible (H1).** `POST /recipes/:id/delete` archived a
  recipe on the first press and permanently deleted it on the second — there
  was no way back from the archive, so it was not an archive, it was a
  staging area for deletion. The repository function `setRecipeArchived`
  already took a boolean and had simply never been called with `false`. A new
  route, **`POST /recipes/:id/restore`**, sets `is_archived = 0`. Owner-only,
  enforced in SQL like every other write (§5.1), answering `404` and never
  `403` for a recipe the acting user may not write. It appears on the recipe
  page, inside the "Manage" disclosure that already holds publishing, the
  public link and Archive, and only when the recipe is archived — shown
  before "Delete permanently", so the reversible action precedes the
  irreversible one. A new route means two places to register it, not one:
  §9's route table and the authorization sweep table in
  `test/authorization.test.js`, which fails loudly if a route is left out of
  it.
- **The import day is local, not UTC (H2).** The Bring! import counter
  (§8.5) records at most one import per recipe per device per day, keyed on a
  day string computed with `new Date().toISOString().slice(0, 10)` — UTC.
  Alex is in Germany; between midnight and 01:00 (winter) or 02:00 (summer),
  the UTC date is still yesterday, so an import in that window is filed under
  the wrong day — if the same device already imported that recipe yesterday,
  the `INSERT OR IGNORE` swallows it and the count does not rise, silently,
  looking exactly like the anti-cheat working as designed. The day is now
  computed in a configured timezone instead of UTC. A new environment
  variable, **`IMPORT_TIMEZONE`**, config key `importTimezone`, optional,
  default **`Europe/Berlin`** — the same shape as `NUMBER_LOCALE` /
  `numberLocale` (§3.1), which is the precedent for a locale-ish setting with
  a sensible default. The anti-cheat's meaning is unchanged: still one count
  per recipe per device per calendar day, only which calendar the day is
  read from changes. What this does not fix, so nobody expects it to: the
  boundary still exists, it has only moved to local midnight, which is where
  a person would expect it.

## Changes in v2.5

v2.4 closed two gaps from the open list. v2.5 is a different kind of round:
driven entirely by using the app on a real phone, against the real domain.
Most of what it fixes is defects that only appear on a device — a keyboard,
a browser engine, a hostname — not in a dev environment; one entry is a
deliberate change to what a quantity means, decided but not yet built. The
full set of decisions:

- **The domain move is done, not deferred (J1).** The public hostname is
  now `bring2bring.<DOMAIN>`. Record what went wrong, because the mechanism
  is worth remembering: `PUBLIC_BASE_URL` still pointed at the old hostname
  after the Cloudflare tunnel was renamed rather than extended, so every
  share link handed to Bring! pointed somewhere that no longer resolved.
  Bring! fetches `/r/<token>` **from its own servers** (§3.1), so the
  failure surfaced only as an unspecific error inside Bring!, with the app
  itself looking healthy. The old hostname was briefly served as an alias
  and has since been removed: the database was reset during the rename, so
  every share token that existed is gone and `/r/<old-token>` would answer
  `404` regardless of DNS. Keeping the alias protected nothing.
- **Enter in an ingredient row adds a row (J2).** Pressing return while
  typing an ingredient submitted the whole recipe, because that is standard
  implicit form submission. It cannot be disabled globally: the search
  fields on both list screens deliberately rely on it, which is how their
  submit buttons were removed without adding JavaScript (§10.E). So the
  interception is scoped to ingredient rows. Enter in the last row adds one
  and focuses it; in any other row it moves down, so editing mid-list does
  not append blank rows.
- **The servings wheel no longer depends on padding overflow (J3).** The
  track centred its outer values with `padding-inline` and relied on that
  padding counting toward the scroll container's scrollable width. Chromium
  counts it; the owner's iPhone Safari does not, so the wheel could not be
  scrolled past 6. Real spacer elements replace it — a flex item
  contributes to scrollable width in every engine. Recorded plainly: the
  earlier fix was measured and correct **in one engine**, and that is why
  it shipped broken.
- **The lens ring is gone (J4).** It duplicated information; the selected
  number is already accent-coloured. The number is now larger instead,
  inside a fixed-size circle so the row does not reflow, and the tick marks
  carry more weight as the only remaining positional indicator. §7.4 and
  §10.E are updated to describe this control, not the one it replaced.
- **The A–Z rail clears the header (J5).** It was pinned at a hardcoded
  48 px and overlapped the burger and theme toggle. Its offset is now
  derived from the same tokens the header is built from.
- **The privacy page links to the common policy (J6).** It documents this
  app's own three cookies; it now also points at
  `https://ahultsch.com/privacy.html`, so the app-specific detail and the
  site-wide policy are both reachable from one place.
- **Switchable ingredient units — decided, not yet built (J7).** The unit
  labels are German while the interface is English. The finding that makes
  this cheap: every unit (§7.2) is stored by a **language-neutral key**
  (`tsp`, `tbsp`, `clove`, `pack`), and only the label is German, so a
  language switch is display-only — no schema change for recipes, and an
  existing recipe becomes readable in both languages the moment the switch
  exists. The chosen scope is **language plus conversions that are exact**
  (g↔oz, kg↔lb, ml↔fl oz, l↔qt). Cups are deliberately excluded: a cup is a
  volume and a gram is a mass, so the ratio depends on the ingredient, and
  §1 principle 5 makes a density guess exactly the wrong-quantity failure
  the app must never produce. Also decided: the two identical count units
  `piece` and `stueck` (§7.2) will be collapsed, which needs a migration.
  Not built as of v2.5.

---

## Changes in v2.6

v2.5 decided J7 but did not build it. v2.6 is the round that builds it — and
while preparing it, two things came to light that change what actually gets
built: one J7 decision turns out to rest on a wrong premise and is reversed,
and one v2.0 decision turns out to have never shipped at all. The full set of
decisions:

- **`piece` and `stueck` stay separate (K1).** This reverses the last sentence
  of J7, which said the two count units would be collapsed with a migration.
  That decision rested on a wrong premise — they were described as identical.
  They are not: `piece` carries an empty label and renders "2 Eier", `stueck`
  carries "Stück" and renders "2 Stück Butter". Collapsing them would either
  give every unit-less ingredient a unit word it never had, or strip the word
  from every ingredient that has one. The only genuine complaint — a German
  key in an otherwise language-neutral key set — is internal and cosmetic,
  and renaming the key would rewrite stored ingredient rows for no
  user-visible gain. So: no ingredient data is migrated for units, ever, in
  this round.
- **D7 was never built, and K3 supersedes it (K2).** §7.2 has said since v2.0
  that `stueck` displays as "pcs"; the code has always said "Stück", because
  `src/domain/units.js` was last changed in v1.1. Recorded rather than
  quietly fixed, because the mechanism matters: a display-only decision with
  no test guarding it can sit in the spec for two versions without anyone
  noticing it never reached the code. K3 resolves the disagreement in the
  direction D7 was reaching for — "Stück" in German, "pcs" in English — and
  adds the test that D7 lacked.
- **Unit language, per user, display-only (K3).** A new `unit_language`
  column on `users` (`'de'` | `'en'`, default `'de'`), set from one control
  on the Account screen (§10.1), delivered by **migration 004**. Every unit
  gains a German and an English label; the key never changes, so nothing
  about a stored recipe depends on the setting and switching it is instant
  and reversible. It applies wherever a unit label is rendered: the recipe
  page, the client-side recalculation (§7.4 — server and browser must keep
  calling the same domain code), and the editor's unit dropdown (§7.2). The
  public share page (§8) has no logged-in viewer, so it renders in the
  **recipe author's** language — which is also what Bring! reads out of that
  page's JSON-LD. Number formatting is untouched and stays `de-DE`; that is
  §16 question 2 and is not answered here.
- **Imperial units are built this round, and they are not display-only in
  the way a label swap is (K4).** This reverses the deferral this bullet
  previously stated: the owner has asked for the whole open list to be
  finished now, so J7's exact conversions (g↔oz, kg↔lb, ml↔fl oz, l↔qt) are
  in scope for v2.6. The bullet is rewritten rather than superseded because
  v2.6 has not shipped yet — a frozen section would have been left alone
  and contradicted in a later one instead. They are not display-only in the
  sense K3's label swap is, because §7.3 rounds in the dimension's base
  unit, and that rule is metric-shaped (nearest 5 g). Rounding in grams and
  then converting yields "8.82 oz", which is not a shoppable quantity, so an
  imperial display has to convert exactly first and round once **in the
  imperial unit** — the rule "round exactly once" survives, but which unit is
  the rounding base becomes a function of the reader's setting (§7.6), and
  the Bring! export (§8.5) has to move with it or the screen and the export
  disagree. That is an amendment to §7.3, not a label table. Cups remain
  excluded for the reason J7 gave: a cup is a volume and a gram is a mass,
  so the ratio depends on the ingredient, and §1 principle 5 makes a
  density guess exactly the wrong-quantity failure the app must never
  produce.

  It is, however, display-only in the sense that matters for storage: no
  stored unit key changes, and the editor's closed dropdown (§7.2) gains no
  imperial option, so recipes are entered in metric and may be read in
  either system. The setting is a second column, `measurement_system`,
  independent of `unit_language`, because English labels with metric
  amounts is a real combination (UK, Australia) and not a nonsense one.
- **Deployment sections catch up with J1 (K5).** §3's `PUBLIC_BASE_URL`
  example and §12.2's compose and Caddyfile blocks still described
  `dishlist.<domain>` two versions after the hostname moved, and §12.2's
  compose block had drifted from the deployed service in other ways as
  well — the wrong volume mount, no container hardening, the mandatory
  `X-Forwarded-Proto` header missing from the reverse-proxy block. Nothing
  is decided here; the sections are simply brought into line with what runs
  on the Pi. Worth recording for the same reason K2 is: this is the second
  piece of drift found in one round, and both went unnoticed because
  nothing executable checks the spec against reality — a deployment section
  is prose, and prose does not fail a test run.
- **Number formatting follows the unit language, not a fixed locale (K6).**
  §7.3 formats decimals with `de-DE` (comma) from `config.numberLocale`,
  unconditionally. An English reader with K3's language control set to
  `en` would see "8,8 oz" — the German decimal comma paired with an
  English unit label, which is neither convention. The number locale now
  follows `unit_language`: `'de'` resolves to `de-DE`, `'en'` to `en-US`.
  `NUMBER_LOCALE` in §3 stays as the default for anything with no reader —
  it is what the German default resolves to. This answers §16 question 2.

---

## Changes in v2.7

A refinement pass on the recipe screen, not a redesign: no route, no data
and no scaling behaviour changes anywhere in this version. The problem
being solved is hierarchy — the accent colour had spread to headings,
bullets and the wordmark until nothing stood out, and the screen's actual
primary action was competing with a theme toggle, an Edit button and a
Duplicate button for the eye. Two of the requested changes turned out to
contradict decisions made in v2.1 and v2.2; both were raised and both were
resolved in favour of the earlier decision, which is why this section
upholds E5 and F3 rather than reversing them. The full set of decisions:

- **The header is three zones, and the wordmark sits in the middle (L1).**
  Back on the left, wordmark centred, burger on the right. The wordmark
  keeps the size and the accent colour F2 gave it — it is the app's
  identity, not decoration, and it is the one place the accent is not
  being rationed by L6. Centring it needs the header to become a
  three-column grid rather than two flex ends, so that the middle stays
  centred on the screen regardless of what the two sides contain.
- **The theme toggle leaves the header for the menu (L2).** It was a
  boxed icon button sitting immediately beside the burger, and the two
  together made the top-right of every screen read as two competing
  controls. Theme is set once and then forgotten, so it belongs with
  Account and Privacy. **Stated consequence:** the menu only renders for
  a logged-in user, so the login screen loses its manual theme control
  and follows the operating system's setting. That is judged acceptable
  because the default already follows the system and a logged-out screen
  is passed through, not lived in.
- **The recipe title moves up (L3).** Nothing between the header rule and
  the `<h1>` earns the gap that was there.
- **The servings row admits it scrolls (L4).** The wheel ran off both
  edges with a hard cut, which read as a clipped layout rather than as
  more content. Both ends now fade. The fade is a mask on the scroll
  container, and it must carry the `-webkit-` prefix as well — v2.5 (J3)
  is the standing reminder that this control has already shipped broken
  once because a scroll behaviour was verified in one engine and assumed
  universal.
- **"Ingredients" stops shouting, and stops repeating the servings
  (L5).** The heading was accent-coloured, bold, and larger than the
  body, and it restated a number the selector directly above it already
  shows and already updates. It becomes a quiet caption in the same style
  as "SERVINGS", and the `data-servings-count` span goes with it. The
  client-side recalculation already guards for that element's absence, so
  nothing breaks; the selector remains the single place the current
  servings are shown, which is what the wheel was for.
- **Green leaves the ingredient list (L6).** The bullets were
  accent-coloured, which spent the strongest signal in the palette on a
  decorative marker repeated once per row. The accent is now reserved for
  four things: the primary action, the selected serving, the active
  navigation item, and positive/on states.
- **The ingredient columns align on every row, including the ones with no
  amount (L7).** An ingredient with no number — a pinch, or "to taste" —
  rendered no amount cell at all, so its name slid left into the amount
  column and broke the two-column read. It now gets an empty cell.
  Recorded as a defect rather than a preference: it was visible on any
  recipe with a pinch in it. **Left deliberately unfixed and still open:**
  the same ingredient renders as "Salz" on the page but reaches Bring! as
  "Prise Salz" in the JSON-LD, because `scaleIngredient` returns a null
  `amountText` for the pinch dimension while its `text` carries the
  label. Screen and export disagreeing is what §8.5 exists to prevent, so
  it needs a decision about what the page should say, not a quiet patch
  alongside a layout fix.
- **"Send to Bring!" is unmistakably the primary action (L8).** It was
  the same height as the minimum tap target and its label was underlined,
  which made the screen's most important control look like a link that
  happened to have a background. It gets real height and loses the
  underline. §1 principle 1 — the app exists to get an existing recipe
  into Bring! in one tap — is the reason this is the one control allowed
  to dominate.
- **Edit and Duplicate stay one tap away, and stop competing (L9).** The
  request was to move them into the burger menu. E5 (v2.1) put them on
  the page deliberately, on the owner's instruction, and that holds: they
  stay. What changes is weight — they lose their bordered button boxes
  and become quiet inline actions below the method, so the only thing
  with a filled background on the screen is the one in L8. This is the
  cheaper half of what the request was actually after: the complaint was
  visual competition, and the tap cost was never the thing being
  complained about.
- **"New" is distinct by shape, not by weight (L10).** The request was
  for a circular floating action. F3 (v2.2) demoted exactly that, and the
  reasoning still holds — the app is for sending existing recipes, not
  adding them. So the plus gets a circular outlined target that marks it
  as a different kind of action, with no accent fill and no raise, and
  "Send to Bring!" remains the only accent-filled button in the app. The
  guard test asserting the navigation has no primary item stays, and a
  second one now asserts the New item carries no accent fill, so the
  shape change cannot quietly become the weight change F3 ruled out. The
  navigation also gets slightly shorter.
- **The Bring icon read as a prohibition sign (L11).** It was already the
  intended leaf-and-arrow rather than a shopping cart, but the arrow's
  shaft was drawn as a single diagonal straight through the leaf, so at
  icon size the whole mark read as a leaf with a line through it — the
  universal symbol for *not allowed*, on the button whose entire job is
  to invite a tap. Redrawn so the arrow sits clear of the leaf. Worth
  recording because the icon was correct by description and wrong by
  appearance, and only looking at it rendered at its real size showed the
  difference.

---

## Changes in v2.8

A second polish round, driven by a written change request from the owner
(Change Request 01) rather than by using the app. The servings control is
rebuilt a fourth time, this time as a vertical drum; the rest is defects,
defaults and copy. No scaling maths changes anywhere in this version — the
request was explicit that it should not, and that constraint is honoured.
The full set of decisions:

- **The servings control becomes a vertical drum (M1).** The horizontal row
  did not read as a wheel: it was not obvious what was selectable, what was
  selected, or that it could be dragged. It becomes a barrel picker — a
  native scroll container with `scroll-snap-type: y mandatory` and
  `scroll-snap-align: center`, so inertia, momentum and snapping come from
  the browser and no drag loop is hand-rolled. Items are 48px; **three are
  visible, not the five the request proposed, giving about 140px** — five
  would have taken a quarter of a 844px phone screen and pushed the
  ingredient list below the fold on the app's main screen, which trades the
  thing the app is for against the control that configures it. The selected
  value sits in a centre band, large and full contrast; neighbours are
  muted and never accent; both ends fade under a vertical mask. The unit
  word "servings" sits beside the number and does **not** scroll with it.
  This is the fourth rebuild of this control (D6's ruler, F5's horizontal
  wheel, J3's Safari fix, J4/L4's polish), and the accumulated lessons are
  carried forward rather than rediscovered: the ten `?yield=N` anchors
  stay, so it still works with JavaScript off (§7.4); the ends are real
  spacer elements rather than padding, because J3 records this control
  shipping broken when trailing padding did not count toward scrollable
  width in Safari; and every mask carries the `-webkit-` prefix for the
  same reason.
- **The drum's accessibility is part of the control, not an afterthought
  (M2).** It exposes `role="spinbutton"` with `aria-valuenow`,
  `aria-valuemin` and `aria-valuemax`; arrow keys change the value; a
  visually hidden number input remains the source of truth for assistive
  technology. Under `prefers-reduced-motion: reduce` the 3D transform and
  smooth scrolling are dropped while the size and opacity difference stays,
  so the selection is still obvious without the motion. A light haptic tick
  fires on each value change via a guarded `navigator.vibrate?.(8)`.
  **Stated plainly because it affects the owner's own device:** Safari on
  iOS does not implement `navigator.vibrate` at all, so on an iPhone the
  tick will silently do nothing. It is included anyway because it is
  guarded, costs nothing, and works on Android.
- **The blur is left out (M3).** The request offered a per-item
  `filter: blur()` proportional to distance from centre, conditional on it
  staying cheap. A blur recomputed on every scroll frame is the most
  expensive thing on the list, and this app is served from a Raspberry Pi
  to a phone. The size, opacity and rotation already carry the depth.
  Recorded rather than silently dropped, because the request explicitly
  made it conditional and this is the condition being exercised.
- **The unit settings hint overlapped the button (M4).** On the Account
  screen the helper text under the units control was drawn over the "Save
  units" button — reproduced at both 390px and 320px, with the hint's top
  above the button's bottom. The hint belongs in normal flow below the
  control, with the action below it and a clear gap from the spacing
  scale. The text is not shortened; the layout is fixed. It must hold at
  320px and at 200% font size.
- **The theme toggle's menu entry is called "Appearance" (M5).** Moving it
  out of the header and into the burger menu was already done in v2.7 (L2)
  and is the reason the request asks for it — the change was pushed but
  not deployed, so it had not been seen. Only the label changes, from
  "Theme" to "Appearance". The pre-paint theme initialisation script is
  untouched, as it was by L2. The interface stays English; the German
  label the request suggested is not recorded as pending work, because the
  answer to that question was "only English".
- **The A–Z rail gets a gap and a clearer position marker (M6).** The
  request reports the rail colliding with the header. It does not —
  measured at 390px and 320px, the rail's top and the header's bottom are
  both at 85px, because J5 (v2.5) already derived the offset. The real
  defect is that the gap is zero, so it reads as crowding, and the fix is
  a real gap plus a height cap so it cannot reach the bottom navigation.
  The letters are also restyled: inert letters small and muted, the
  current letter larger and in an accent pill, so position is obvious
  rather than inferred. Touch targets stay at least 24px by padding rather
  than by font size, and the active letter must stay legible against the
  accent pill in dark mode. **No `--header-height` token is introduced**:
  the offset stays derived from the tokens the header is actually built
  from, because a second source of truth for the same number is how these
  two elements drifted apart in the first place.
- **"No unit" is labelled "N.A." (M7).** In the editor's unit dropdown the
  no-unit option reads "N.A." in both label languages. This is the
  dropdown's own label only: the canonical stored key is unchanged, the
  unit's *display* label stays the empty string so an ingredient still
  renders "2 Eier" rather than "2 N.A. Eier", and no stored recipe is
  migrated or altered.
- **A new ingredient row defaults to grams (M8).** It defaulted to the
  no-unit option purely because that option is first in the closed list.
  Grams is what most rows actually are, and the default is now `g` in
  both label languages. The order of the dropdown is unchanged; only which
  option starts selected.
- **The editor's servings field is a dropdown, and the accent is rationed
  everywhere (M9).** In the recipe *editor* the servings control becomes a
  plain `<select>` of 1–10 defaulting to 4, and its helper text goes: a
  closed list cannot be filled in wrongly, so the sentence explaining the
  valid range had nothing left to explain. The drum stays on the recipe
  *view* only — editor is a form, view is a wheel, and that split is
  deliberate. Separately, L6's accent rationing extends from the recipe
  screen to the whole interface: the list's alphabetical section letters
  and the Account screen's headings were still accent coloured, which
  meant green marked "heading" on one screen and "action" on another.
  Green now means only the primary action, the selected serving, the
  active navigation item, the active rail letter, on-states, and the
  wordmark. The error page's large status number went with them: a 404
  rendered in the same green as a success message and a primary action is
  the clearest case of the accent meaning nothing at all, so it is muted
  text now.
- **An honest note about Bring! (M10).** A new page reachable from exactly
  one place — a burger-menu entry labelled "About Bring!" — stating
  plainly that Bring2Bring! is not affiliated with Bring! Labs AG, is not
  paid by them, is not an advertisement, and shares no data beyond the
  recipe the user explicitly chooses to send. It appears nowhere else: no
  footer note, no link beside the export button, no banner. Plain text,
  **no Bring! logo or branding assets**, because using their marks would
  undercut the exact point the note is making. The text is English
  regardless of the unit-label language.

---

## 1. Purpose

Bring2Bring! is Alex's own private cookbook on the web. Recipes are entered once,
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
  no unit choice, no free-text label override. **Since v2.1 (E7)**, that
  count is validated as an integer in 1..10, the same range the
  interactive control uses (§7.4). The `yield_unit` and `yield_label`
  columns remain in the schema at their defaults (§5).
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
4. SQLite database file at `process.env.DB_PATH`, default `./data/bring2bring.db`.
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
| `DB_PATH` | no | `./data/bring2bring.db` | SQLite file |
| `UPLOAD_DIR` | no | `./data/uploads` | Recipe images |
| `SESSION_SECRET` | **yes** | — | Session cookie signing key |
| `ADMIN_USER` | **yes** | — | Admin login name, used by `seed:admin` |
| `ADMIN_PASSWORD` | **yes** | — | Admin password, used by `seed:admin` |
| `PUBLIC_BASE_URL` | **yes** | — | e.g. `https://bring2bring.ahultsch.com`; used to build absolute share URLs for Bring! |
| `TRUST_PROXY` | no | `1` | Express `trust proxy` hops (Caddy + cloudflared) |
| `NODE_ENV` | no | `production` | |
| `NUMBER_LOCALE` | no | `de-DE` | Locale used to format scaled ingredient quantities |
| `IMPORT_TIMEZONE` | no | `Europe/Berlin` | Timezone the Bring! import counter's day boundary is computed in (§8.5, H2) |

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
Bring2Bring/
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
  unit_language TEXT CHECK(unit_language IN ('de','en')) DEFAULT 'de',  -- K3
  measurement_system TEXT CHECK(measurement_system IN ('metric','imperial')) DEFAULT 'metric',  -- K4
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
  device_id TEXT NOT NULL,               -- from the bring2bring.did cookie
  day TEXT NOT NULL,                     -- YYYY-MM-DD in IMPORT_TIMEZONE (H2)
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
key, a German display label, an English display label (K3, since v2.6),
dimension (`mass`, `volume`, `count`, `spoon`, `pinch`), base factor, and
whether the unit may be auto-converted.

Since v1.1 (§2.1 A1) the unit field in the editor is a closed dropdown, not
free text, so the table is deliberately small — exactly:

| key | German label | English label | dimension |
| --- | --- | --- | --- |
| `piece` | (empty string) | (empty string) | count |
| `g` | g | g | mass |
| `kg` | kg | kg | mass |
| `ml` | ml | ml | volume |
| `l` | l | l | volume |
| `tsp` | TL | tsp | spoon |
| `tbsp` | EL | tbsp | spoon |
| `pinch` | Prise | pinch | pinch |
| `stueck` | Stück | pcs | count |

"No unit" is stored as the `piece` unit (count dimension with empty label), so
`2 Eier` renders without a unit word while still getting the count rounding
rule (§7.3: nearest whole number, never below 1). This is a deliberate
internal representation, not an accident — it lets `piece` (displayed as
"2 Eier") and the `stueck` unit (displayed as "2 Stück Butter" in German,
"2 pcs Butter" in English) share the count rounding and conversion rules
while differing only in the label shown. The `stueck` unit was new in v1.1;
D7 (v2.0) decided its label should read "pcs" but was never implemented, and
K3 (v2.6) resolves that by giving every unit both labels — see §7.5. The key
is unchanged, so this is a display-only change: nothing stored migrates.
`piece` and `stueck` are deliberately kept as two separate units and are not
collapsed (K1, since v2.6): the empty label and "Stück" are a real
difference in what renders, not a duplication.

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

Which unit the single rounding happens in is a function of the reader's
measurement system (§7.6): the dimension's metric base unit (`g`, `ml`)
under `metric`, its imperial small unit (`oz`, `fl oz`) under `imperial`.
The conversion from the stored, scaled quantity into that unit is exact and
unrounded; the ladder below is then applied **once**, to that number, and
the ladder itself is unchanged. Rounding in grams and then converting to
oz is exactly the mistake this rule exists to prevent — it yields "8.82 oz",
which is not a shoppable quantity.

| Case | Rule |
| --- | --- |
| ≥ 100 (g, ml) | round to nearest 5 |
| 10–99 | round to nearest 1 |
| 1–9.99 | 1 decimal place |
| < 1 | 2 decimal places, and prefer a converted-down unit if one exists |
| `count` dimension (eggs, onions) | round to nearest whole number, never below 1 — a fractional count is not shoppable, and rounding to the nearest 0.5 made small scaled amounts appear not to change across servings |
| `pinch`, `to taste` | never numeric |

Trailing zeros are stripped (`2.0 → 2`). Decimals are rendered with the
locale-appropriate separator for the reader's `unit_language` (K6, since
v2.6): `de` → `de-DE` (comma), `en` → `en-US` (period) — this is a display
setting resolved in `config.js`, not scattered through templates.
`NUMBER_LOCALE` in §3 remains the default for anything rendered with no
reader (it is what the German default resolves to).

### 7.4 UI behaviour — servings control rebuilt (D6, since v2.0)

- The recipe page has a yield control: a vertical drum of **integers 1 to
  10**, default 4 (M1, since v2.8, replacing the v2.7 horizontal wheel,
  L4) — a native scroll container, `scroll-snap-type: y mandatory` with
  `scroll-snap-align: center` on each 48px item, so momentum and snapping
  come from the browser rather than a hand-rolled drag loop. Three items
  are visible at once (about 140px): the selected value sits in a centre
  band, large and full contrast, its neighbours above and below are muted
  and never accent, and both ends fade under a vertical mask. The unit
  word "servings" sits beside the number and does not itself scroll.
  Momentum can carry a flick past several numbers and settle on the
  nearest one; this can overshoot the intended value, which §1 principle
  5 ("a wrong quantity is worse than no export") makes worth stating — it
  is acceptable because the ingredient amounts and the heading update
  live as the drum moves, so a wrong quantity is visible before it is
  sent, never sent silently. Tapping a number still selects it directly.
  The old `−/+` buttons, the `×0.5`/`×2` presets and free numeric entry
  are all **removed**. Underneath the drum, each item is still one of the
  ten `?yield=N` anchors carried forward from F5, so the control still
  works with JavaScript off.
- **The drum is accessible as a control, not decorated with accessibility
  afterward (M2, since v2.8).** It exposes `role="spinbutton"` with
  `aria-valuenow`, `aria-valuemin` and `aria-valuemax`; arrow keys change
  the value; a visually hidden number input remains the source of truth
  for assistive technology. Under `prefers-reduced-motion: reduce` the 3D
  transform and smooth scrolling are dropped while the size and opacity
  difference stays, so the selection remains obvious without the motion.
  A light haptic tick fires on each value change via a guarded
  `navigator.vibrate?.(8)` — a no-op on iOS Safari, which does not
  implement the API, and a real tick on Android.
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
  12 for a party is no longer possible from the UI. **Since v2.1 (E7)**,
  the stored `yield_amount` is itself validated to an integer in 1..10 on
  submit, so the control's range and the data's range are the same range —
  this reverses the earlier rule that only the control, not the stored
  value, was bounded. Rows saved before v2.1 that fall outside 1–10 are
  deliberately **not** migrated: such a recipe still renders and still
  scales correctly from its true base, the ruler simply shows no
  selection until one is picked, and the next edit surfaces the
  validation error.
- Scaled values that were rounded show the exact value in a `title` tooltip.
- The editor has no UI to mark an ingredient `scales = false` (§2.1 A2), so
  in practice every ingredient scales — there is no "unchanged" marker to
  show.

### 7.5 Unit language — per user, display-only (K3, since v2.6)

The unit labels were German while the interface is English; this section
makes the label language a per-user setting without touching anything the
setting does not need to touch.

- `users.unit_language`, `TEXT NOT NULL DEFAULT 'de'`, constrained to `'de'`
  or `'en'`, added by **migration 004**.
- One control on the Account screen (§10.1): a plain form post, in the style
  of the password form already there — no JavaScript, consistent with §10.F
  and the no-inline-script rule (§11).
- The label lookup is a pure function of (unit key, language) and lives in
  `src/domain/units.js`, so the server render and the browser recalculation
  (§7.4) resolve labels through the same code — exactly as they already do
  for scaling.
- The language reaches the browser the same way the number locale already
  does: as a `data-` attribute on the recipe container, read by
  `public/js/recipe-view.js`.
- `/r/:token` (§8) has no logged-in viewer, so it renders in the **recipe
  author's** language; the JSON-LD Bring! consumes is generated from the
  same already-scaled, already-labelled ingredients.
- What does **not** change: stored `unit` keys, the scaling engine, the
  rounding rules (§7.3), and stored quantities. Number formatting is the
  one thing this setting does reach beyond labels: its decimal separator
  follows the language (K6, §7.3).

### 7.6 Measurement system — per user, display-only (K4, since v2.6)

Metric amounts are the only thing a recipe ever stores. This section makes
the *display* system — metric or imperial — a second per-user setting,
independent of §7.5's language setting, without widening what the editor
accepts or what a recipe stores.

- `users.measurement_system`, `TEXT NOT NULL DEFAULT 'metric'`, constrained
  to `'metric'` or `'imperial'`, added by **migration 004**. One control on
  the Account screen (§10.1), beside the language control: a plain form
  post, no JavaScript.
- The imperial unit family, used for display only:

  | key | label | dimension | grams / millilitres per unit |
  | --- | --- | --- | --- |
  | `oz` | oz | mass | 28.349523125 g |
  | `lb` | lb | mass | 453.59237 g |
  | `floz` | fl oz | volume | 29.5735295625 ml |
  | `qt` | qt | volume | 946.352946 ml |

  These are the exact legal definitions, not approximations: 1 lb = 16 oz
  exactly, 1 US liquid quart = 32 US fluid ounces exactly. The labels are
  the same in German and English — German has no separate word for an
  ounce — so, unlike §7.2's table, this family does not need two label
  columns.
- These keys are **display-only**: never stored in `ingredients.unit`, and
  never offered by the editor's unit dropdown (§7.2), which stays the
  closed list of nine. A recipe is entered in metric and may be read in
  either system.
- Rounding follows §7.3: the single rounding pass happens in `g`/`ml` under
  `metric` or `oz`/`floz` under `imperial`, whichever the reader's
  `measurement_system` selects.
- Converting up uses the same rule metric already uses, with the family's
  own numbers: display in the large unit when the rounded amount reaches
  one of them *and* is exactly representable to two decimals, otherwise
  stay in the small unit. `32 oz → 2 lb`, `24 oz → 1.5 lb`,
  `20 oz → 1.25 lb`, but `18 oz` stays `18 oz` — precisely as `1235 g`
  stays `1235 g` rather than becoming `1.24 kg`.
- Unaffected by the measurement system: `spoon` (`tsp`/`tbsp` are already
  the customary English names, and no conversion happens), `count`, and
  `pinch`. Only `mass` and `volume` have an imperial family.
- `/r/:token` (§8) has no logged-in viewer, so it renders in the **recipe
  author's** measurement system, for the same reason §7.5 gives for
  language. The Bring! export (§8.5) is generated from the same
  already-scaled, already-labelled ingredients, so the screen and the
  export cannot disagree.
- What does **not** change: stored quantities, stored unit keys, the
  scaling factor arithmetic (§7.1), and the rounding ladder in §7.3.

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
`bring2bring.did` identifies a device: 16 random bytes, base64url-encoded,
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
| POST | `/recipes/:id/restore` | **since v2.4** — un-archives (`is_archived = 0`). Owner only, enforced in SQL; `404` not `403` (§5.1, H1) |
| POST | `/recipes/:id/duplicate` | **since v2.0** — anyone who can read the recipe (owner or public, D2); copy is private, no share token, import count 0 |
| POST | `/recipes/:id/publish` | **since v2.0** — toggle `is_public` (D1); enabling also enables the share token (§8.2, §10) |
| POST | `/recipes/:id/share/link` | Enable / rotate / disable public token |
| GET | `/recipes/:id/bring` | **since v2.0** — records a Bring! import, `302`s to the deeplink (§8.5, D4) |
| GET | `/recipes/:id/export.json` | |
| GET | `/export/all.json` | |
| GET | `/r/:token` | **public** share page (§8.3) |
| GET | `/uploads/:file` | **public** images — only reachable via unguessable filename. `image_path` is always `NULL` in v1.1 (§5), so this route is currently unused, kept for when images come back |
| GET | `/account`, POST `/account/password` | |
| GET | `/privacy` | **since v2.0** — Privacy page: documents the `bring2bring.did` cookie and nothing else tracked (D5, D4, §11) |
| GET | `/about-bring` | **since v2.8** — About Bring! page: states Bring2Bring! is not affiliated with, paid by, or advertising for Bring! Labs AG (M10) |
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
body text, high contrast — unchanged from v1, and still non-negotiable, save
for the recorded tap-target exception in §10.E.

### 10.0 Navigation

- **Header**, three zones (L1, since v2.7): back (or nothing) on the
  left, the wordmark centred, burger on the right — a three-column grid,
  not two flex ends, so the middle stays centred regardless of what the
  two sides contain. The wordmark keeps the size and accent colour F2
  gave it. The theme toggle is not a header control; it lives in the
  burger menu (L2, since v2.7).
- **Bottom navigation bar**, thumb-reachable, exactly three equal items:
  **My Recipes**, **Public**, **New** — the accent colour marks only
  whichever one is current (F3, since v2.2). **New** is additionally
  marked by a circular outline rather than by accent fill (L10, since
  v2.7): distinct by shape, not by weight, so it stays the ordinary
  navigation item F3 made it. This also supplies the way back from a
  recipe to a list — a gap v1.1 had, since it removed navigation along
  with everything else that wasn't essential.
- **Burger menu**, top right: Account, Appearance, Privacy, About Bring!,
  Report a bug, Log out. The theme control moved here from the header
  (L2, since v2.7) and is labelled "Appearance" (M5, since v2.8) — it is
  set once and then forgotten, so it belongs beside Account and Privacy
  rather than competing with the burger control for the top-right corner.
  The menu only renders for a logged-in user, so the login screen has no
  manual theme control and follows the operating system's setting.
  **About Bring!** is new (M10, since v2.8): a disclosure page, reachable
  from nowhere else, stating that Bring2Bring! is not affiliated with,
  paid by, or advertising for Bring! Labs AG.
- The **archive moves into the burger menu**, out of the main flow — it was
  reachable from the list in v1, it is a deliberate extra step now.

### 10.1 Pages

- **My Recipes / Public** — cards: title and **import count**
  (`bring_import_count`) — no longer the servings; it isn't interesting at a
  glance (D5). **Public** cards also show the **author** as `@username`;
  My Recipes omits it, since every recipe listed there is by definition the
  signed-in user's own (§10.E). Search box is **title-first**; ingredient
  search is a secondary toggle beside it, not the default — finding a
  recipe by name is the common case, ingredient search is occasional, and
  the control reflects that. **Default sort is alphabetical**, with an
  **A–Z rail** down the edge to jump to a letter. Empty state on My
  Recipes links straight to "New recipe"; empty state on Public explains
  that no recipes have been published yet. Public is listed by every logged-in
  user; a recipe's presence there requires no ownership check beyond
  `is_public = 1` (D2).
- **Recipe** — title, meta line, yield control (the 1–10 drum, §7.4),
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
- **Editor** — one page, no wizard. Servings is a plain `<select>` of 1–10
  defaulting to 4 (M9, since v2.8) — a closed list needs no helper text
  explaining the valid range, so none is shown; the drum stays on the
  recipe view only. Ingredient rows: amount, unit (the
  fixed dropdown, §7.2), name — add or remove a row, no drag reordering, no
  quick-add line, no per-row toggles. Method is a single, optional
  textarea, stored and shown exactly as typed. Autosave draft to
  `localStorage` so a dropped connection never loses a half-typed recipe.
- **Share page** — recipe only, stripped down further than the app view:
  name, servings and ingredients only, no method (§8.4).
- **Privacy** — new, since v2.0. Documents the `bring2bring.did` device cookie
  (§8.5, §11) as the one cookie of its kind in the app, and states plainly
  that there is no third-party tracking or analytics (§11).
- **About Bring!** — new, since v2.8 (M10). Reachable only from the burger
  menu. Plain text stating that Bring2Bring! is not affiliated with, not
  paid by, and not advertising for Bring! Labs AG, and shares no data
  beyond the recipe the user explicitly chooses to send. No Bring! logo or
  branding asset appears on it. English regardless of the unit-label
  language (§7.5), since the interface itself is English-only.
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

**The accent colour is rationed, app-wide (L6, since v2.7; extended by M9,
since v2.8).** L6 scoped the rule to the recipe screen; the list's
alphabetical section letters and the Account screen's headings were still
accent-coloured, which meant green marked "heading" on one screen and
"action" on another. It is now reserved for the same short list
everywhere in the interface: the primary action, the selected serving,
the active navigation item, the active A–Z rail letter (§10.E), and
positive/on states — plus the wordmark, which F2 already claimed and L1
does not touch. It marks nothing else: not a heading, not a bullet, not a
decorative repeat.

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
`i-chevron-up`, `i-book` (My Recipes), `i-people` (Public), `i-plus` (New),
`i-bring` (the import mark), `i-globe` (public link), `i-copy`, `i-rotate`,
`i-disable`, `i-account`, `i-privacy`, `i-bug`, `i-archive`, `i-logout`,
`i-filter`, `i-sun` (theme toggle, dark mode), `i-moon` (theme toggle, light
mode).

The sprite is **inlined into every page**, not linked as an external `.svg`
referenced by URL: Safari on iOS does not reliably support `<use>` pointing
at an external file, and the primary device for this app is a phone. Icons
take their colour from `currentColor`, never a hard-coded `fill` — so an
icon always follows the token colouring the text around it, and never needs
a separate colour kept in sync.

`i-bring` — the mark shown next to every import count and on the "Send to
Bring!" button — is a leaf with an arrow, per the mockup: natural,
movement, deliberately not a shopping-cart cliché. It is drawn stroked, at
the same weight as the rest of the set, so it does not read heavier than the
icons around it.

Icon size is likewise tokenised (since v2.1): `--icon-size-sm` (16px),
`--icon-size` (20px) and `--icon-size-lg` (24px), in `tokens.css` alongside
the other sizing tokens. Without this, `.icon` sized itself in `em`, so the
same symbol rendered at whatever size the surrounding text happened to be —
one place to change a symbol, but no matching one place to change its size.
`--icon-size` is the default, used wherever an icon sits beside body text;
`--icon-size-sm` is for icons beside small or caption text (the import
count, the search field, the public-link disclosure chevron); `--icon-size-lg`
is for the bottom navigation bar. The
default was chosen to match what the old `1.25em` already rendered at next
to 16px body text — 20px — so introducing the token changed no existing
screen.

### 10.E Screen anatomy

One paragraph per screen, matching the mockup:

1. **My Recipes** — a search field with a magnifier control inside the
   field itself that submits the search, and a secondary "ingredients"
   toggle beside it — a link, not a submit button — off by default; the
   screen needs no submit button of its own and therefore no inline
   script. Rows are sorted A–Z with letter section headers, no longer
   accent-coloured (M9, since v2.8, extending L6's rationing app-wide). An
   A–Z rail runs down the right edge (starting with `#`), held off the
   header by a real gap and capped short of the bottom navigation (M6,
   since v2.8) — the rail's top and the header's bottom were already both
   at 85px (J5, since v2.5), so the fix is spacing, not a repositioning;
   it is dragged, not read (F6, since v2.2) — dragging along it magnifies
   the letter under the finger into a bubble that tracks the finger, and
   the list jumps to that section when the finger lifts (scrolling
   mid-gesture would make the browser cancel the pointer and end the
   drag), a letter with no recipes stays dim and does not jump, and
   scrolling the list brightens the letter currently in view; inert
   letters are small and muted, the current letter is larger and sits in
   an accent pill, legible in both themes (M6, since v2.8); every letter
   remains a real anchor.
   Each row shows the recipe name as body text and the import count with
   the `i-bring` mark, above the bottom nav. **Deliberate deviation from
   the mockup:** the mockup also shows an author name under each recipe
   on this screen, but on My Recipes every recipe is by definition the
   signed-in user's own, so the author line is omitted here and shown
   only on the Public shelf (§10.1).
2. **Recipe** — the three-zone header (back on the left, the centred
   wordmark, burger on the right — L1, since v2.7), then, in this reading
   order (E5, since v2.1): the title, immediately below the header rule
   with no claimed gap (L3, since v2.7), a "Servings" section with the
   1–10 vertical drum (M1, since v2.8, replacing the v2.7 horizontal
   wheel, L4) — three 48px items visible, the selected number in a large,
   full-contrast centre band, its neighbours muted, both ends fading
   under a mask — and the accessibility contract of M2 (spinbutton role,
   arrow-key input, a reduced-motion fallback, a guarded haptic tick),
   then "Ingredients" — a quiet caption, no longer repeating the servings
   count the selector above it already shows (L5, since v2.7) — the
   ingredient list, the primary "Send to Bring!" button, now full height
   with no underline so it reads as the one dominant control on the
   screen (L8, since v2.7), then "Method", then Edit and Duplicate as
   quiet inline actions with no button box (L9, since v2.7), then a
   single collapsed disclosure holding publishing, the public link,
   Archive, and — for an archived recipe only, before "Delete
   permanently" — Restore (since v2.4, H1). Edit and Duplicate stay one
   tap away; the disclosure holds only what is touched once per recipe
   rather than once per cook.
3. **Public** — laid out as My Recipes, except each row also shows the
   author as `@username`, and the header carries a sort control of three
   segmented links — A–Z / Most imported / Recently added — rather than
   a `<select>` with a submit button, in place of the ingredients toggle
   alone.
4. **Burger** — a panel over the page from the right, with a close control
   and the items Account, Appearance, Privacy, About Bring!, Report a
   bug, Archive, Log out (moved here from the header and relabelled from
   "Theme" — L2, since v2.7; M5, since v2.8). About Bring! is new (M10,
   since v2.8): plain text disclaiming any affiliation with, payment
   from, or advertising for Bring! Labs AG, with no Bring! logo or
   branding asset on the page. Log out and other destructive items use
   the `danger` token (§10.B). The control that opens the panel stays
   reachable above the scrim while it is open, and
   closing the panel works with JavaScript off (F4, since v2.2).

**Tap-target exceptions (since v2.1, updated in v2.2 and v2.8).** One
control falls short of the 44 px minimum restated in §10.F, deliberately
and recorded here rather than taken silently: the A–Z rail's letters —
its drag-magnified bubble (F6) makes them easier to hit in practice
without making the letters themselves any bigger, and each letter now
holds at least 24px by padding rather than by font size (M6, since
v2.8), so the smaller inert letters stay hittable. The servings control
is no longer an exception: the 48px drum item (M1, since v2.8, replacing
F5's scroll wheel) gives each position the full `--min-tap-target`
height, where the v2.1 ruler it replaced only had about 29 px per
position.

**Bottom nav** — three equal items, always present on list and recipe
screens: My Recipes, Public, and New — the accent colour marks only
whichever one is current (F3, since v2.2). New is additionally marked by
a circular outline rather than accent fill (L10, since v2.7). This is
also the way back from a recipe to a list.

### 10.F Rules that survive

Restated, not weakened:

- Mobile-first.
- Minimum 44 px tap targets, minimum 16 px body text, high contrast — see
  §10.E for the recorded exception (the A–Z rail). A "keep screen awake"
  toggle on the Recipe page using the Wake Lock API where available,
  degrading silently where not.
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
- **Device cookie (D4, since v2.0):** `bring2bring.did` identifies a device for
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
bring2bring:
  build: ./apps/bring2bring
  restart: unless-stopped
  read_only: true
  tmpfs: [/tmp]
  security_opt: [no-new-privileges:true]
  environment:
    PORT: "3000"
    DB_PATH: /data/bring2bring.db
    UPLOAD_DIR: /data/uploads
    PUBLIC_BASE_URL: https://bring2bring.${DOMAIN}
    NPM_CONFIG_CACHE: /tmp/.npm     # writable npm cache under read_only: true
  env_file:                         # optional long-form: missing .env must not
    - path: ./apps/bring2bring/.env # break the whole compose file (Pi-hole/DNS
      required: false               # depend on it starting too)
  volumes:
    - ./data/bring2bring:/data
  networks: [edge]
  # no ports: — reachable only through caddy
```

Caddyfile block:

```
@bring2bring host bring2bring.{$DOMAIN}
handle @bring2bring {
    # cloudflared speaks plain HTTP to caddy:80, so without this header
    # express-session silently refuses to set the secure session cookie
    # and login fails in production with no error.
    reverse_proxy bring2bring:3000 {
        header_up X-Forwarded-Proto https
    }
}
```

Then: a `sites.conf` entry with `admin yes` (so the shared admin credentials
are seeded), a Cloudflare Published Application route
`bring2bring.<domain> → http://caddy:80`, and an Uptime Kuma monitor on
`https://bring2bring.<domain>/healthz`.

The Pi's nightly backup already covers `data/`, so the SQLite file and the
uploads are backed up as soon as they live under `data/bring2bring/`. Verify this
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
| **C** | *v2.0.* Import counter: D4 in full (`/recipes/:id/bring`, `bring2bring.did`, `bring_imports`), sorting and filtering by import count, the Privacy page. **Migration 003.** |
| **D** | *v2.6.* Unit language (K3): German/English labels for every unit, `users.unit_language`, the Account control, and the share page rendering in the author's language. Measurement system (K4): the imperial display family, `users.measurement_system`, its own Account control, and the amended §7.3 rounding rule. Number locale follows unit language (K6). **Migration 004.** |
| **E** | *v2.7.* Recipe screen refinement (L1–L11): centred wordmark, theme toggle into the menu, rationed accent, aligned ingredient columns, a taller Send to Bring!, quieted Edit/Duplicate, a shape-distinct New, and a redrawn Bring icon. **No schema change.** |
| **F** | *v2.8.* Change Request 01 (M1–M10): the servings drum replacing the horizontal wheel with its accessibility contract, the Account-screen hint/button overlap fixed, the "Appearance" menu label, the A–Z rail's gap and letter treatment, "N.A." in the unit dropdown, grams as the new-row unit default, the editor's servings dropdown, accent rationing extended app-wide, and the About Bring! disclosure page. **No schema change.** |

Each of A, B, C, D, E and F is independently deployable. Phases 0–3 above
are the record of what shipped to get here; they are not revised by
A/B/C/D/E/F.

Later, explicitly not in v1: meal planning, weekly plans, "cooked on" history,
recipe import by URL scraping, PWA/offline, shopping-list management inside
Bring2Bring! (Bring! is the shopping list — duplicating it defeats the purpose).

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
  functional cookie, `bring2bring.did`, exists solely to cap the Bring! import
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
2. ~~Recipe content language: German content in an English UI — confirm that
   date/number formatting should follow `de-DE` (§7.3). Bring's catalog
   matching also works best when ingredient names are in one consistent
   language.~~ — **Answered in v2.6.** Number formatting follows the
   reader's `unit_language` rather than a single global locale (K6, §7.3),
   so a German reader keeps the comma and an English reader gets the
   period. Ingredient names are untouched and stay in whatever language
   they were entered in.
3. ~~Subdomain: `dishlist.ahultsch.com`, or something more cookbook-like?~~
   — **Answered in v2.5.** The hostname is now `bring2bring.<DOMAIN>` (J1).
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
7. **Rename to Bring2Bring! — decided, recorded at G1.** The rename itself,
   its two forms, what carries each, and its consequences are recorded at
   G1 ("Changes in v2.3"), not repeated here. ~~What remains open: whether
   the hostname `dishlist.ahultsch.com` and its Cloudflare tunnel route are
   ever renamed to match — Alex has deferred that part, deliberately,
   leaving the app served, for now, from a hostname that no longer matches
   its name.~~ — **Answered in v2.5.** The hostname is now
   `bring2bring.<DOMAIN>` (J1, "Changes in v2.5").
