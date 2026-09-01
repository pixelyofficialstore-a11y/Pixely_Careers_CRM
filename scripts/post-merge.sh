#!/bin/bash
set -e

# Keep merges reproducible without requiring interactive input. The project uses
# pnpm's lockfile, so prefer the lockfile-aware install and fall back to npm only
# for environments where pnpm is unavailable.
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
else
  npm install --no-audit --no-fund
fi

npx tsx scripts/run-migrations.ts
npm run build
