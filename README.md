# Mardi & Kadri

Runs at **https://laskesisse.ee**. A map of households expecting *mardisandid* (10 November) and *kadrisandid* (25 November), to keep the Estonian tradition alive alongside Halloween. Households list their house with a time window and house rules; listings are deleted automatically once the day has passed.

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
   - Application restriction **Websites**: `https://laskesisse.ee/*`, `https://laskesisse.<your-subdomain>.workers.dev/*` (preview builds) and `http://localhost:5173/*` for development.
   - API restriction: Maps JavaScript API and Places API (New) only.
4. Under *Google Maps Platform → Map management → Create Map ID*: type **JavaScript**, **Vector**. One Map ID is enough: the app asks for the dark variant on the Mardi tab and the light one on Kadri. Without it the app uses Google's testing-only `DEMO_MAP_ID`. A custom style can be attached to the Map ID later (*Map styles*) without code changes.
5. Recommended: set a budget alert on the billing account.
6. In the Cloudflare dashboard, *Worker → Settings → Variables and Secrets*, add `GOOGLE_MAPS_API_KEY` (the key) and `MAP_ID_MARDI` / `MAP_ID_KADRI` (both the same Map ID, unless you make two styles). `keep_vars` in `wrangler.jsonc` keeps them across deploys. The browser receives the key and Map ID, as Google intends; the website restriction is what protects the key.

### 2. Cloudflare D1 database

Nothing to do. `wrangler.jsonc` names the database `laskesisse` without an id, so the first deploy creates it and the deploy command then applies `migrations/`. It shows up under *Storage & Databases → D1*.

### 3. Workers Builds (the deploy pipeline)

In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, connect GitHub and pick `ozooner/laskesisse`.

| Setting | Value |
| --- | --- |
| Project name | `laskesisse` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (`wrangler deploy`, then D1 migrations) |
| Non-production branch deploy command | `npx wrangler versions upload` (default; gives preview URLs) |

Note that preview versions use the same D1 database as production.

If the deploy step fails creating or migrating the database with an authentication error, give the build's API token the **D1 Edit** permission (*Settings → Builds → API token*).

Migrations run right after the new code goes live, so write them to be compatible with the previous version of the code (add columns, don't rename).

### 4. Turnstile (optional, recommended before launch)

1. Dashboard → **Turnstile → Add widget**, add the hostnames `laskesisse.ee` and `localhost`.
2. Add the **site key** as variable `TURNSTILE_SITE_KEY` in the dashboard (*Variables and Secrets*). Include your `*.workers.dev` hostname in the widget while testing there.
3. Add the **secret key** as type **Secret**, name `TURNSTILE_SECRET_KEY`.

Without the secret, the server skips the check (handy locally).

### 5. Domain: laskesisse.ee

1. In the Cloudflare dashboard, **Add a domain** → `laskesisse.ee` (Free plan is fine). Cloudflare shows two nameservers.
2. At your .ee registrar, replace the domain's nameservers with those two. Propagation usually takes minutes to a few hours.
3. Once the zone shows as **Active**, uncomment `routes` in `wrangler.jsonc`. The next deploy attaches `laskesisse.ee` to the Worker, including DNS record and TLS certificate.
4. Optional `www.laskesisse.ee`: add a proxied DNS record `www` (CNAME to `laskesisse.ee`) and a **Redirect Rule** (*Rules → Redirect Rules*, template "Redirect from WWW to root") so there is one canonical address.

### 6. Cloudflare Access (keep it private before launch)

Access sits in front of the Worker, so nobody reaches the site or `/api` without logging in. No code changes are needed.

- **workers.dev and preview URLs:** *Worker → Settings → Domains & Routes*, on the `workers.dev` and **Preview URLs** rows choose **Enable Cloudflare Access**. Then click **Manage Cloudflare Access** and set the policy to allow your e-mail addresses (one-time PIN login works without any identity provider).
- **laskesisse.ee (once attached):** *Zero Trust → Access → Applications → Add an application → Self-hosted*, domain `laskesisse.ee`, policy **Allow** with *Emails* = your testers. Add `www.laskesisse.ee` too if you created it.
- **Launch:** delete the Access application (or switch its policy to *Bypass → Everyone*) for `laskesisse.ee`. Keeping Access on the preview URLs is fine.

## Local development

Node 24 (pinned to 24.22.1 in `.node-version`, which Workers Builds and nvm/fnm pick up).

```sh
npm install
cp .dev.vars.example .dev.vars   # put GOOGLE_MAPS_API_KEY here for local use
npm run db:migrate:local
npm run dev                      # http://localhost:5173, Worker + frontend together
```

The browser console logs `laskesisse build <time> (<commit>)` on load, so you can tell which deploy is live.

`npm run build` type-checks and builds; `npx wrangler deploy --dry-run` checks the deploy bundle without uploading.
