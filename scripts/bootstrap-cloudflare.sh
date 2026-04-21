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

find_existing_namespace_id() {
  local binding="$1"
  local list_output
  local id

  list_output="$(pnpm wrangler kv namespace list)"
  id="$(printf '%s\n' "$list_output" | node -e '
    const fs = require("fs");
    const binding = process.argv[1];
    const input = fs.readFileSync(0, "utf8");
    const start = input.indexOf("[");

    if (start === -1) {
      process.exit(0);
    }

    try {
      const namespaces = JSON.parse(input.slice(start));
      const match = namespaces.find((entry) => entry.title === binding);
      if (match?.id) {
        process.stdout.write(match.id);
      }
    } catch {
      process.exit(0);
    }
  ' "$binding")"

  printf '%s' "$id"
}

ensure_namespace() {
  local binding="$1"
  local output
  local id

  if output="$(pnpm wrangler kv namespace create "$binding" 2>&1)"; then
    printf '%s\n' "$output" >&2
    id="$(printf '%s\n' "$output" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -n 1)"
  else
    printf '%s\n' "$output" >&2

    if printf '%s\n' "$output" | grep -q "already exists"; then
      id="$(find_existing_namespace_id "$binding")"
    else
      exit 1
    fi
  fi

  if [[ -z "$id" ]]; then
    echo "Failed to resolve namespace id for $binding" >&2
    exit 1
  fi

  printf '%s' "$id"
}

SITES_ID="$(ensure_namespace SITES)"
SESSIONS_ID="$(ensure_namespace SESSIONS)"

node - "$WRANGLER_TOML" "$SITES_ID" "$SESSIONS_ID" <<'EOF'
const fs = require("fs");

const [filePath, sitesId, sessionsId] = process.argv.slice(2);
let text = fs.readFileSync(filePath, "utf8");

text = text.replace(/binding = "SITES"\s+id = "[^"]+"/m, `binding = "SITES"\nid = "${sitesId}"`);
text = text.replace(/binding = "SESSIONS"\s+id = "[^"]+"/m, `binding = "SESSIONS"\nid = "${sessionsId}"`);

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
