# I Am Robot

Cloudflare Worker demo for a path-mounted "I'm a robot" challenge service.

The app now deploys as a single Worker that:

- serves the static frontend from [site/index.html](/Users/primaryuser/Desktop/i-am-robot/site/index.html)
- serves the API from [src/index.ts](/Users/primaryuser/Desktop/i-am-robot/src/index.ts)
- is intended to run at `https://castrio.me/i-am-robot`

## Runtime Shape

Production URLs:

- App page: `https://castrio.me/i-am-robot`
- API start: `https://castrio.me/i-am-robot/api/challenge/start`
- API submit: `https://castrio.me/i-am-robot/api/challenge/submit`
- API verify: `https://castrio.me/i-am-robot/api/verify`

Current challenge types:

- `timed_math`
- `randomness_audit`
- `code_error`

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Create KV namespaces

```bash
npx wrangler kv namespace create SITES
npx wrangler kv namespace create SESSIONS
```

Copy the returned IDs into [wrangler.toml](/Users/primaryuser/Desktop/i-am-robot/wrangler.toml) by replacing:

- `replace-with-sites-kv-id`
- `replace-with-sessions-kv-id`

### 3. Add a signing secret

Recommended:

```bash
npx wrangler secret put SIGNING_SECRET
```

Local fallback:

- [wrangler.toml](/Users/primaryuser/Desktop/i-am-robot/wrangler.toml) also includes `DEV_SIGNING_SECRET` so local development still works before you configure a real secret.
- Replace or remove that before deploying publicly.

### 4. Seed the demo site record

```bash
npx wrangler kv key put --binding SITES "site:site_demo_123" '{
  "siteKey": "site_demo_123",
  "secret": "secret_demo_abc",
  "allowedHostnames": ["castrio.me", "localhost:8787", "localhost:3000", "127.0.0.1:8787"]
}'
```

### 5. Run the Worker locally

```bash
npm run dev
```

Open either:

- [http://127.0.0.1:8787/i-am-robot](http://127.0.0.1:8787/i-am-robot)
- [http://127.0.0.1:8787/](http://127.0.0.1:8787/)

For local Worker-served assets, leave the `API base` field empty so the UI uses same-origin requests automatically.

## Deploy To `castrio.me/i-am-robot`

These are the exact steps to put this Worker on the same Cloudflare zone as your other project.

### Fast path

After logging in to Wrangler, you can let the repo do most of the setup:

```bash
pnpm run cf:bootstrap
```

If you want the script to also upload the signing secret automatically, provide it inline:

```bash
SIGNING_SECRET="replace-me-with-a-real-secret" pnpm run cf:bootstrap
```

The bootstrap script will:

- create the `SITES` KV namespace
- create the `SESSIONS` KV namespace
- write those ids into [wrangler.toml](/Users/primaryuser/Desktop/i-am-robot/wrangler.toml)
- seed the `site_demo_123` record in KV
- optionally upload `SIGNING_SECRET` if you provided it

### 1. Log in to Cloudflare from Wrangler

```bash
npx wrangler login
```

### 2. Confirm `wrangler.toml`

[wrangler.toml](/Users/primaryuser/Desktop/i-am-robot/wrangler.toml) should contain:

- the real KV namespace IDs
- the route:
  - `castrio.me/i-am-robot*`
- the static asset directory:
  - `./site`

This repo is already configured for that route shape.

### 3. Set the production signing secret

```bash
npx wrangler secret put SIGNING_SECRET
```

Use a real random secret here.

### 4. Seed the production site config

```bash
npx wrangler kv key put --binding SITES "site:site_demo_123" '{
  "siteKey": "site_demo_123",
  "secret": "secret_demo_abc",
  "allowedHostnames": ["castrio.me"]
}'
```

If you want the same key to work locally too, include the localhost entries as well.

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Verify the route in Cloudflare

In the Cloudflare dashboard:

1. Open `Workers & Pages`
2. Open the `i-am-robot` Worker
3. Go to `Settings`
4. Open `Domains & Routes`
5. Confirm the route is attached to:
   - `castrio.me/i-am-robot*`

### 7. Test production

Open:

- [https://castrio.me/i-am-robot](https://castrio.me/i-am-robot)

Then verify:

- the page loads
- CSS and JS load correctly
- `New Challenge` loads a challenge
- successful answers return a signed `resultToken`

## API Examples

### `POST /i-am-robot/api/challenge/start`

```json
{
  "siteKey": "site_demo_123",
  "hostname": "castrio.me",
  "mode": "prove_robot"
}
```

### `POST /i-am-robot/api/challenge/submit`

```json
{
  "sessionId": "sess_...",
  "answer": {
    "value": "off_by_one"
  }
}
```

### `POST /i-am-robot/api/verify`

```json
{
  "secret": "secret_demo_abc",
  "resultToken": "header.payload.signature"
}
```

## Notes

- Static assets are served by the same Worker using Cloudflare Workers static assets.
- Session records are stored in KV with a short TTL.
- Result tokens are HMAC-signed by the Worker.
- The countdown shown in the UI is cosmetic. The server-side deadline is authoritative.
- This is still a demo and does not yet include one-time-use token revocation, analytics, or stateful challenges like chess.
