# Cloudflare deployment

Production releases are manual. Validation runs on every push and pull request, while `.github/workflows/deploy.yml` deploys only when explicitly started from GitHub Actions.

## Cloudflare resources

- Worker name: `esports-live-api`
- Pages project: `esports-live`
- Production branch: `main`

Create the Pages project once before the first web release:

```bash
npx wrangler pages project create esports-live --production-branch main
```

## Worker secret

Configure the Riot LoL Esports API key directly in Cloudflare. Do not expose it to the web application or commit it to the repository.

```bash
npx wrangler secret put LOL_ESPORTS_API_KEY
```

For local Worker development, copy `.dev.vars.example` to `.dev.vars` and insert the development key. `.dev.vars` must remain uncommitted.

## GitHub deployment credentials

Create these GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token should be restricted to the Cloudflare account and resources used by this project.

Create this GitHub Actions repository variable after the first API deployment:

- `VITE_API_BASE_URL` — the HTTPS origin of the production API Worker, without a trailing slash

The Riot API key is intentionally not stored in GitHub.

## Release order

For the first release:

1. Configure the Cloudflare Worker secret.
2. Run **Deploy Cloudflare** with target `api`.
3. Verify `GET /health` and copy the Worker origin.
4. Set the GitHub variable `VITE_API_BASE_URL` to that origin.
5. Create the Pages project if it does not already exist.
6. Run **Deploy Cloudflare** with target `web`.

After initial setup, target `all` validates and deploys both applications.

## Local commands

```bash
npm install
npm run check
npm run dev:api
npm run dev:web
```

Manual CLI deployment remains available:

```bash
npm run deploy:api
VITE_API_BASE_URL=https://your-worker.example.workers.dev npm run build:web
npx wrangler pages deploy apps/web/dist --project-name esports-live --branch main
```
