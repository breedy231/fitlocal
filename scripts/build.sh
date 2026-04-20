#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Building FitLocal..."

echo "  → Installing dependencies..."
npm install --workspaces

echo "  → Building API..."
npm run build -w packages/api

echo "  → Building Web..."
npm run build -w packages/web

echo "Done! Start with: NODE_ENV=production node packages/api/dist/server.js"
