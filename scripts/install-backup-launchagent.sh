#!/bin/bash
# Installs the hourly-backup LaunchAgent (com.fitlocal.backup).
# Idempotent: re-running refreshes the symlink and reloads the agent.
set -e

PLIST_NAME="com.fitlocal.backup.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PROJECT_DIR/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ ! -f "$PLIST_SRC" ]; then
  echo "Error: $PLIST_SRC not found"
  exit 1
fi

# Stop existing agent if loaded
launchctl bootout "gui/$(id -u)/com.fitlocal.backup" 2>/dev/null || true

# Symlink plist
ln -sf "$PLIST_SRC" "$PLIST_DST"

# Load agent
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "FitLocal backup LaunchAgent installed!"
echo "  Schedule: every 3600s (hourly while awake)"
echo "  Backups:  ~/fitlocal-backups/"
echo "  Logs:     ~/Library/Logs/fitlocal-backup.log"
echo "  Stop:     launchctl bootout gui/$(id -u)/com.fitlocal.backup"
