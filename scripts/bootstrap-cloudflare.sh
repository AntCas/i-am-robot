#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER_TOML="$ROOT_DIR/wrangler.toml"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but was not found in PATH." >&2
  exit 1
fi

if [[ ! -f "$WRANGLER_TOML" ]]; then
  echo "Could not find wrangler.toml at $WRANGLER_TOML" >&2
  exit 1
fi

echo "Bootstrapping Cloudflare resources for i-am-robot..."

create_namespace() {
  local binding="$1"
  local output
  local id

  output="$(pnpm wrangler kv namespace create "$binding")"
  printf '%s\n' "$output"

  id="$(printf '%s\n' "$output" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -z "$id" ]]; then
    echo "Failed to parse namespace id for $binding" >&2
    exit 1
  fi

  printf '%s' "$id"
}

SITES_ID="$(create_namespace SITES)"
SESSIONS_ID="$(create_namespace SESSIONS)"

node - "$WRANGLER_TOML" "$SITES_ID" "$SESSIONS_ID" <<'EOF'
const fs = require("fs");

const [filePath, sitesId, sessionsId] = process.argv.slice(2);
let text = fs.readFileSync(filePath, "utf8");

text = text.replace('id = "replace-with-sites-kv-id"', `id = "${sitesId}"`);
text = text.replace('id = "replace-with-sessions-kv-id"', `id = "${sessionsId}"`);

fs.writeFileSync(filePath, text);
EOF

echo "Updated wrangler.toml with KV namespace ids."

if [[ -n "${SIGNING_SECRET:-}" ]]; then
  printf '%s' "$SIGNING_SECRET" | pnpm wrangler secret put SIGNING_SECRET
  echo "Set SIGNING_SECRET from environment."
else
  echo "SIGNING_SECRET not provided. Skipping secret upload."
  echo "Run this manually when ready:"
  echo "  pnpm wrangler secret put SIGNING_SECRET"
fi

SITE_CONFIG='{
  "siteKey": "site_demo_123",
  "secret": "secret_demo_abc",
  "allowedHostnames": ["castrio.me"]
}'

pnpm wrangler kv key put --binding SITES "site:site_demo_123" "$SITE_CONFIG"
echo "Seeded demo site config in KV."

cat <<EOF

Bootstrap complete.

Created namespaces:
  SITES:    $SITES_ID
  SESSIONS: $SESSIONS_ID

Next steps:
  1. If needed, log in: pnpm wrangler login
  2. If you skipped the signing secret: pnpm wrangler secret put SIGNING_SECRET
  3. Deploy: pnpm wrangler deploy
EOF
