#!/bin/bash
# Double-click to host a game night. This is the ONE thing you run:
#   - builds the client (always — it's under a second, and stale JS served to
#     a phone is a nasty silent-failure bug to chase, so we don't skip this)
#   - starts the single game server
#   - opens the stage screen in your browser
# Phones join over the same Wi-Fi via the QR code on the stage screen. The
# stage also has an "Admin" button top-right that opens the puppeteer/settings
# panel in its own tab — that's your admin & settings view.
#
# Pass --skip-build to skip the rebuild (rarely useful; only if you know
# nothing changed and want to start a few hundred ms faster).
set -e
cd "$(dirname "$0")"

echo "🕰  Grimoire — Blood on the Clocktower"

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies…"
  npm install --no-audit --no-fund
fi

if [ "$1" != "--skip-build" ]; then
  echo "Building the client…"
  npm run build --workspace=@grimoire/client
fi

# Open the stage once the server is up.
( sleep 2 && open "http://localhost:3111/#/stage" ) &

echo "Starting the server (close this window to end the game night)…"
echo "Look below for the addresses phones on your Wi-Fi should use."
npm run start --workspace=@grimoire/server
