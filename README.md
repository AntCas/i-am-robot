# I Am Robot

Cloudflare Worker for a path-mounted "I'm a robot" verification widget.

The app deploys as a single Worker that:

- serves the static frontend from [site/index.html](/Users/primaryuser/Desktop/i-am-robot/site/index.html)
- serves the API from [src/index.ts](/Users/primaryuser/Desktop/i-am-robot/src/index.ts)
- is intended to run at `https://castrio.me/im-a-robot`

## Runtime Shape

Production URLs:

- App page: `https://castrio.me/im-a-robot`
- API docs page: `https://castrio.me/im-a-robot/docs`
- OpenAPI JSON: `https://castrio.me/im-a-robot/openapi.json`
- API start: `https://castrio.me/im-a-robot/api/challenge/start`
- API submit: `https://castrio.me/im-a-robot/api/challenge/submit`
- API verify: `https://castrio.me/im-a-robot/api/verify`

Current challenge types:

- `timed_math`
- `randomness_audit`
- `code_error`

Each site config can also set:

- `requiredChallengesToPass`: how many consecutive successful challenges are required before the Worker issues a valid `resultToken`
- `allowedHostnames`: which hostnames may embed and use the widget
- `secret`: the server-side secret used when calling the verify API

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

Then update the `id` fields for the `SITES` and `SESSIONS` bindings in [wrangler.toml](/Users/primaryuser/Desktop/i-am-robot/wrangler.toml).

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
  "allowedHostnames": ["castrio.me", "localhost:8787", "127.0.0.1:8787"],
  "requiredChallengesToPass": 3
}'
```

### 5. Run the Worker locally

```bash
npm run dev
```

The Worker now serves both the page and the static assets locally, so a separate Python static server is no longer needed.

Open either:

- [http://127.0.0.1:8787/im-a-robot](http://127.0.0.1:8787/im-a-robot)
- [http://127.0.0.1:8787/](http://127.0.0.1:8787/)

## Deploy To `castrio.me/im-a-robot`

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
- both routes:
  - `castrio.me/im-a-robot`
  - `castrio.me/im-a-robot/*`
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
  "allowedHostnames": ["castrio.me"],
  "requiredChallengesToPass": 3
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
5. Confirm both routes are attached:
   - `castrio.me/im-a-robot`
   - `castrio.me/im-a-robot/*`

### 7. Test production

Open:

- [https://castrio.me/im-a-robot](https://castrio.me/im-a-robot)

Then verify:

- the page loads
- CSS and JS load correctly
- the widget loads a challenge
- the widget only returns a signed `resultToken` after the configured number of successful challenges

## Embed Example

The demo page uses:

```html
<robot-check-widget
  site-key="site_demo_123"
  app-base-path="/im-a-robot"
></robot-check-widget>
```

For the hosted service shape, `site-key` should be the public identifier you issue to customers. The Worker now treats challenge progress as server-owned state, so clients cannot mint a valid `resultToken` early by skipping the widget's UI flow.

You also need to load the widget script:

```html
<script type="module" src="/im-a-robot/widget.js"></script>
```

Optional widget attributes:

- `site-key`: public site identifier; defaults to `site_demo_123`
- `app-base-path`: base path where the Worker is mounted; defaults to `/im-a-robot` when embedded under that path and `""` otherwise
- `privacy-path`: override for the Privacy link
- `terms-path`: override for the Terms link

When verification completes, the widget dispatches a bubbling `robot-verification-passed` event with:

```js
{
  detail: {
    resultToken: "header.payload.signature",
    expiresAt: "2026-05-09T12:34:56.000Z"
  }
}
```

Example host-page integration:

```html
<robot-check-widget
  id="robot-check"
  site-key="site_demo_123"
  app-base-path="/im-a-robot"
></robot-check-widget>

<script type="module" src="/im-a-robot/widget.js"></script>
<script>
  document.getElementById("robot-check").addEventListener("robot-verification-passed", async (event) => {
    const { resultToken, expiresAt } = event.detail;
    console.log("Verification passed", { resultToken, expiresAt });

    // Send resultToken to your own backend, then have your backend call
    // POST /im-a-robot/api/verify with your site secret.
  });
</script>
```

## API Docs

The canonical API contract lives in [site/openapi.json](/Users/primaryuser/Desktop/i-am-robot/site/openapi.json).

Use the rendered docs page for endpoint details, schemas, examples, and response shapes:

- Local: [http://127.0.0.1:8787/im-a-robot/docs](http://127.0.0.1:8787/im-a-robot/docs)
- Production: [https://castrio.me/im-a-robot/docs](https://castrio.me/im-a-robot/docs)

The raw OpenAPI document is also available at:

- Local: [http://127.0.0.1:8787/im-a-robot/openapi.json](http://127.0.0.1:8787/im-a-robot/openapi.json)
- Production: [https://castrio.me/im-a-robot/openapi.json](https://castrio.me/im-a-robot/openapi.json)

## Notes

- Static assets are served by the same Worker using Cloudflare Workers static assets.
- Challenge sessions and verification sessions are stored in KV with a 15 minute TTL.
- Result tokens are HMAC-signed by the Worker and expire after 5 minutes.
- The countdown shown in the UI is cosmetic. The server-side deadline is authoritative.
- Allowed hostnames are enforced per site config.
- The Worker accepts both root-style paths like `/api/verify` and path-mounted paths like `/im-a-robot/api/verify`.
