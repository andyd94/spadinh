#!/bin/bash
# Registers the Soulseek bridge (soulseek-search.py) with every Chromium-based browser on this Mac,
# for this checkout's location. Re-run after moving the folder. No sudo needed.
#
# The extension id is fixed by the "key" in manifest.json, so it's the same on every machine.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$HERE/soulseek-search.py"
EXT_ID="onhlmcgjfnopeojjoocnmneahejhhlmh"

chmod +x "$HOST"

registered=0

for support in \
    "$HOME/Library/Application Support/Google/Chrome" \
    "$HOME/Library/Application Support/Chromium" \
    "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"; do
    [ -d "$support" ] || continue

    mkdir -p "$support/NativeMessagingHosts"
    cat > "$support/NativeMessagingHosts/com.spadinh.soulseek.json" <<EOF
{
  "name": "com.spadinh.soulseek",
  "description": "spadinh: search SoulseekQt for the playing track",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
    echo "registered for $(basename "$support")"
    registered=1
done

if [ "$registered" = 0 ]; then
    echo "no Chrome, Chromium or Brave profile found under ~/Library/Application Support" >&2
    exit 1
fi

echo
echo "Now reload the extension in chrome://extensions. Its id should read $EXT_ID."
echo "The first Shift+S will make macOS ask to let Google Chrome control your computer (Accessibility);"
echo "allow it, then press Shift+S again."
