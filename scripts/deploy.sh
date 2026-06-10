#!/bin/bash
# Build and restart the production server.
# Usage: npm run deploy
set -e

echo "Building..."
npm run build

echo "Restarting server..."
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
sleep 1
node packages/api/dist/server.js &

echo "Waiting for server..."
sleep 2
curl -sf http://localhost:3001/api/workouts > /dev/null && echo "Production server up on :3001" || echo "WARNING: server did not respond"
