# Dishlist

Dishlist is Alex's private digital cookbook. Recipes are entered once, viewed
on a phone in the kitchen, scaled to any number of servings, and pushed into
the [Bring!](https://www.getbring.com/) shopping-list app in one tap with
correctly scaled quantities.

## How the Bring! integration works, and why the share page must be public

Bring!'s deeplink endpoint does not receive data from the browser. It takes a
URL, and **Bring's own servers fetch that URL** and parse it for
schema.org/Recipe markup. That means the share page at `GET /r/:token` has to
answer with **no session, no cookie, and no redirect to login** — it must be
reachable, as complete server-rendered HTML, by an arbitrary non-browser user
agent from an unknown IP. It carries only the recipe: no navigation, no user
name, no login form.

This is also why the route is mounted ahead of the session, cookie-parser and
CSRF middleware in `src/app.js` — a logged-in browser never touches this code
path, and neither does anything that could redirect it to `/login`.

**Cloudflare caution:** if any bot-fighting rule or Access policy is ever
enabled for this hostname, `/r/*` must be excluded from it, or Bring!'s
fetcher gets blocked while the site still looks perfectly normal in a
browser — the import just silently stops working.

The share page emits both JSON-LD (`<script type="application/ld+json">`) and
matching microdata `itemprop` attributes, describing the same already-scaled
values. No extra work is needed for this to also make the share URL
importable by Mealie, Tandoor, Paprika, AnyList, and Samsung Food — they read
the same schema.org markup Bring! does.

## Running locally

```
cp .env.example .env
# edit .env with real values
npm install
npm run seed:admin
npm start
npm test
```

## Configuration

See `SPECIFICATION.md` §3.1 for the full list of environment variables and
their rules.

## Deploying on the Pi

Dishlist runs as a service in `PiMultiServiceServer`'s compose stack:

```yaml
dishlist:
  build: ./apps/dishlist
  restart: unless-stopped
  env_file: ./apps/dishlist/.env
  environment:
    PORT: "3000"
    DB_PATH: /data/dishlist.db
    UPLOAD_DIR: /data/uploads
    PUBLIC_BASE_URL: https://dishlist.${DOMAIN}
  volumes:
    - ./data/dishlist:/data
  networks: [edge]
```

The `DB_PATH` and `UPLOAD_DIR` environment variables are set explicitly because the
app's defaults are relative to its working directory, so the mount point and the
paths must agree.

Caddyfile block:

```
@dishlist host dishlist.{$DOMAIN}
handle @dishlist {
    reverse_proxy dishlist:3000 {
        header_up X-Forwarded-Proto https
    }
}
```

Also needed: a `sites.conf` entry with `admin yes` (so the shared admin
credentials get seeded), a Cloudflare Published Application route
`dishlist.<domain> → http://caddy:80`, and an Uptime Kuma monitor on
`https://dishlist.<domain>/healthz`.

`PUBLIC_BASE_URL` is set in the compose file's `environment:` block, **not**
in `apps/dishlist/.env` — the Pi's `scripts/deploy.sh` rewrites that `.env` on
every run and would drop it.

Any reverse proxy in front of Dishlist **must** pass `X-Forwarded-Proto: https`
through to the app, or the session cookie (which is marked `secure` in
production) never gets set: express-session silently withholds `Set-Cookie`
when it doesn't see the request as secure, so login accepts credentials, 302s,
and then just bounces back to the login form — this is shown in the Caddyfile
block above.

The Pi's nightly backup already covers `data/`, so once the SQLite file and
uploads live under `data/dishlist/` on the host they are backed up
automatically — verify this explicitly rather than assuming it.

### Container image

The image is pinned to `node:24.19.0-alpine3.24` in both build and runtime
stages (see `Dockerfile`) — no floating tags, per the platform rule.

## Project layout

```
server.js              entry point: loads config, opens the DB, runs
                        migrations, starts listening
src/config.js           env var loading and validation (zod)
src/app.js               Express app assembly: middleware order, routes
src/domain/              pure, dependency-free scaling/unit/JSON-LD logic;
                          served as-is to the browser at /js/domain
src/repositories/        all SQL; every query enforces the acting user's
                          access
src/services/            business logic that sits between routes and
                          repositories (auth, recipes, sharing)
src/routes/               HTTP route handlers
src/middleware/           session, CSRF, auth, rate limits, logging, errors
src/db/                   SQLite connection and migrations
src/views/                server-rendered EJS templates
public/                  static CSS and client-side JS (no build step)
scripts/seed-admin.js    creates/updates the admin account
test/                    node:test suite
```

## Status

Implemented, per the milestones in `SPECIFICATION.md` §12.3:

- **0** — repo skeleton, Dockerfile, config, migrations, `seed:admin`,
  `/healthz`, login.
- **1** — recipe CRUD, list, view, ingredient groups, steps, tags.
- **2** — scaling engine with unit/rounding logic and full unit tests, yield
  control.
- **3** — share tokens, public share page with JSON-LD + microdata, Bring!
  button.

Not yet implemented:

- **4** — invite registration, per-user sharing, account management.
- **5** — images, text/JSON export, print view, JSON import.
