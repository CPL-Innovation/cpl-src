# CPL Sports Research Collections

## Architecture

The application uses SQLite as its single catalog source of truth. The API logic lives in `server/app.mjs` and talks to the database through `@libsql/client`. Locally it reads `data/catalog.sqlite`, which contains the image and interview metadata plus transcript text. In production on Vercel it runs as a serverless function (`api/index.mjs`) against a hosted [Turso](https://turso.tech) database, which is SQLite-compatible. Existing database rows are not overwritten on startup, so transcript edits persist.

The Vite React app and catalog editor read records from `GET /api/items`. The admin app creates records with `POST /api/items` and saves metadata and transcript edits with `PATCH /api/items/:id`. Vite proxies `/api` requests to the API server during development.

The database has two tables:

- `items`: shared metadata for images and audio records.
- `interviews`: transcript text linked to `items.id` with a foreign key.

## Requirements

- Node.js 20 or newer.
- npm.

## Full-stack development

Install the frontend dependencies once:

```bash
npm install
```

Start the API in one terminal:

```bash
npm run server
```

Start Vite in a second terminal:

```bash
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173/`. The public catalog is at `/`; the catalog editor is at `/admin`.

The API listens on `http://localhost:3001` by default. Set `PORT` to use another port. If the API runs on another host or port, set `VITE_API_URL` before starting Vite, for example `VITE_API_URL=http://localhost:4000 npm run dev`.

## Production build

Build the frontend with:

```bash
npm run build
```

The build output is written to `dist/`.

## Deploy to Vercel

Vercel serves the built site and runs the API as a serverless function. `vercel.json` rewrites every `/api/*` request to `api/index.mjs`. Vercel's file system is read-only, so the catalog lives in a hosted Turso database instead of `data/catalog.sqlite`.

1. Create a Turso database and an auth token, either in the Turso dashboard or with the CLI:

   ```bash
   turso db create cpl-catalog
   turso db show cpl-catalog --url
   turso db tokens create cpl-catalog
   ```

2. Copy the local catalog into it. The script creates the tables and skips rows that already exist, so it is safe to re-run:

   ```bash
   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run seed:turso
   ```

3. In the Vercel project settings, add the environment variables `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then redeploy. Leave `VITE_API_URL` unset: the site and the API share a domain.

Once deployed, edits made in `/admin` are saved to Turso, not to `data/catalog.sqlite`. Set the same two environment variables locally to run `npm run server` against the hosted database.

## Generate an SRT transcript

Install and configure WhisperX separately, then run it against the new audio file:

```bash
whisperx filename.mp3 --language en --diarize --model large-v2 --align_model WAV2VEC2_ASR_LARGE_LV60K_960H --condition_on_prev_text False --output_format srt
```

WhisperX writes an `.srt` file next to the audio input by default. Rename it to match the catalog record ID, for example `p4014coll27_48.srt`. Open `/admin`, create or select the corresponding Audio record, and paste the generated SRT into its Transcript field before saving. The transcript is stored in `data/catalog.sqlite`.

## Data operations

`data/catalog.sqlite` is the checked-in catalog database. Do not delete or replace it during normal operation. Transcript changes made through the admin editor are written directly to this file. To make a backup, copy the database while the API is stopped.