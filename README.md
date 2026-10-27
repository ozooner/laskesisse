# Mardi & Kadri

A map of households expecting *mardisandid* (10 November) and *kadrisandid* (25 November), to keep the Estonian tradition alive alongside Halloween. Households list their house with a time window and house rules; listings are deleted automatically once the day has passed.

- **Frontend:** Vite + TypeScript, Google Maps JavaScript API (Advanced Markers, Places Autocomplete, marker clustering). UI is Estonian only.
- **Backend:** one Cloudflare Worker that serves the built frontend as static assets and a JSON API under `/api/*`, with data in Cloudflare D1.
- **Deploy:** Cloudflare Workers Builds: a push to `main` deploys production, other branches get preview URLs.

## How it behaves

- The default tab is the next upcoming event in Europe/Tallinn time (Mardipäev until 10 Nov, then Kadripäev until 25 Nov, then next year's Mardipäev). `#mardi` / `#kadri` in the URL selects a tab.
- Each tab has its own palette: dark wool and straw for Mardi, white linen and red for Kadri. Each can have its own Google Map ID (style).
- "Ootan sante" opens a form that first tells the user their address is deleted automatically when the day has passed. Address comes from Places Autocomplete; the pin can be dragged to the exact door.
- No accounts. Creating a listing returns a private edit link (`/?muuda=<id>.<token>`), which is also remembered in the browser. Only a SHA-256 hash of the token is stored.
- A daily cron (00:15 Tallinn time in November) deletes listings whose date has passed. The API also only ever returns listings for the upcoming date.
- Anyone can report a listing; it is hidden after 3 reports.
- Cloudflare Turnstile protects the form when configured.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/config` | Public keys for the frontend |
| GET | `/api/houses?event=mardi\|kadri` | Listings for the upcoming date of that event |
| GET | `/api/houses/:id` | One listing |
| POST | `/api/houses` | Create; returns `{ id, editToken, eventDate }` |
| PATCH | `/api/houses/:id` | Update; `Authorization: Bearer <editToken>` |
| DELETE | `/api/houses/:id` | Delete; `Authorization: Bearer <editToken>` |
| POST | `/api/houses/:id/report` | Report a listing |

## Setup checklist

### 1. Google Maps

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and attach a billing account (required even within the free monthly usage).
2. Enable **Maps JavaScript API** and **Places API (New)**.
3. Create an API key under *APIs & Services → Credentials* and restrict it:
   - Application restriction **Websites**: `https://martjakadri.<your-subdomain>.workers.dev/*`, your own domain later, and `http://localhost:5173/*` for development.
   - API restriction: Maps JavaScript API and Places API (New) only.
4. Optional: under *Google Maps Platform → Map management*, create two **JavaScript / Vector** Map IDs (one dark style for Mardi, one light for Kadri). Without them the app uses Google's `DEMO_MAP_ID`.
5. Recommended: set a budget alert on the billing account.
6. Put the key (and Map IDs) into `vars` in `wrangler.jsonc`. This key is meant to be public; the website restriction is what protects it.

### 2. Cloudflare D1 database

```sh
npm install
npx wrangler login
npx wrangler d1 create martjakadri
```

Copy the printed `database_id` into `wrangler.jsonc` and commit it.

### 3. Workers Builds (the deploy pipeline)

In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, connect GitHub and pick `ozooner/martjakadri`.

| Setting | Value |
| --- | --- |
| Project name | `martjakadri` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (runs D1 migrations, then `wrangler deploy`) |
| Non-production branch deploy command | `npx wrangler versions upload` (default; gives preview URLs) |

Note that preview versions use the same D1 database as production.

If the deploy step fails on the migration with an authentication error, give the build's API token the **D1 Edit** permission (*Settings → Builds → API token*).

### 4. Turnstile (optional, recommended before launch)

1. Dashboard → **Turnstile → Add widget**, add your hostname(s).
2. Put the **site key** into `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
3. Store the **secret key** as a Worker secret: `npx wrangler secret put TURNSTILE_SECRET_KEY` (or *Worker → Settings → Variables and Secrets*).

Without the secret, the server skips the check (handy locally).

### 5. Domain (later)

Add a custom domain under *Worker → Settings → Domains & Routes* and add it to the Google API key's website restrictions.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # put GOOGLE_MAPS_API_KEY here for local use
npm run db:migrate:local
npm run dev                      # http://localhost:5173, Worker + frontend together
```

`npm run build` type-checks and builds; `npx wrangler deploy --dry-run` checks the deploy bundle without uploading.
