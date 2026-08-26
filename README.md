# Dishlist

Dishlist is Alex's private digital cookbook. Recipes are entered once, viewed
on a phone in the kitchen, scaled to any number of servings, and pushed into
the Bring! shopping-list app in one tap with correctly scaled quantities.

## Status

Under construction — phase 0 of the milestones in `SPECIFICATION.md` §12.3
(repo skeleton, Dockerfile, config, migrations, seed:admin, /healthz, login).

## Requirements

- Node.js >= 22 for development.
- The container image used in deployment is `node:24-alpine`.

## Local development

```
cp .env.example .env
# edit .env with real values
npm install
npm test
```

`npm start` does not work yet — `server.js` is added in a later step.

## Configuration

See `SPECIFICATION.md` §3.1 for the full list of environment variables and
their rules.
