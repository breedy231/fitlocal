#!/bin/bash
set -e

PLIST_NAME="com.fitlocal.server.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PROJECT_DIR/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ ! -f "$PLIST_SRC" ]; then
  echo "Error: $PLIST_SRC not found"
  exit 1
fi

# Build first
echo "Building FitLocal..."
"$PROJECT_DIR/scripts/build.sh"

# Stop existing agent if loaded
launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true

# Symlink plist
ln -sf "$PLIST_SRC" "$PLIST_DST"

# Load agent
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "FitLocal LaunchAgent installed and running!"
echo "  Logs: ~/Library/Logs/fitlocal.log"
echo "  Stop: launchctl bootout gui/$(id -u)/$PLIST_NAME"
