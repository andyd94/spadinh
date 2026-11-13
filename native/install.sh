#!/bin/bash
# Registers the Soulseek bridge (soulseek-search.py) with every Chromium-based browser on this Mac,
# for this checkout's location. Re-run after moving this folder or Downloadinh's. No sudo needed.
#
#   bash native/install.sh [path to the downloadinh checkout]
#
# The bridge runs on Downloadinh's code and config, so it needs to know where Downloadinh lives
# (default: a "downloadinh" folder next to this checkout, or $DOWNLOADINH_DIR) and a Python 3.11+
# that has `requests` (default: Downloadinh's venv, or $DOWNLOADINH_PYTHON). Both are written into
# native/soulseek-host, the launcher Chrome actually starts.
#
# The extension id is fixed by the "key" in manifest.json, so it's the same on every machine.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$HERE/soulseek-search.py"
LAUNCHER="$HERE/soulseek-host"
EXT_ID="onhlmcgjfnopeojjoocnmneahejhhlmh"

DL="${1:-${DOWNLOADINH_DIR:-$HERE/../../downloadinh}}"

if [ ! -f "$DL/downloadinh/slskd.py" ]; then
    echo "no Downloadinh checkout at $DL" >&2
    echo "clone github.com/andyd94/downloadinh, then: bash native/install.sh /path/to/downloadinh" >&2
    exit 1
fi

DL="$(cd "$DL" && pwd)"

# Chrome starts hosts with a bare PATH, so the launcher needs the interpreter's full path.
works() {
    [ -x "$1" ] && PYTHONPATH="$DL" "$1" -c \
        'import sys; assert sys.version_info >= (3, 11); import requests, downloadinh.pipeline' 2>/dev/null
}

PY=""

for candidate in \
    "${DOWNLOADINH_PYTHON:-}" \
    "$DL/.venv/bin/python" \
    "$DL/venv/bin/python" \
    "$HOME/.venvs/downloadinh/bin/python" \
    "$(command -v python3 || true)" \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3; do
    if [ -n "$candidate" ] && works "$candidate"; then
        PY="$candidate"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "no Python 3.11+ with requests found for Downloadinh - set it up as its README says" >&2
    echo "(python3 -m venv ~/.venvs/downloadinh && ~/.venvs/downloadinh/bin/pip install -e $DL)," >&2
    echo "or point DOWNLOADINH_PYTHON at one, then run this again" >&2
    exit 1
fi

# From Downloadinh's folder, so its downloadinh.toml is found the same way the CLI finds it.
cat > "$LAUNCHER" <<EOF
#!/bin/bash
cd "$DL" || exit 1
export PYTHONPATH="$DL"
exec "$PY" "$HOST"
EOF
chmod +x "$LAUNCHER"

echo "bridge runs $PY on $DL"

if [ ! -f "$DL/downloadinh.toml" ] && [ ! -f "$HOME/.config/downloadinh/config.toml" ]; then
    echo "note: no downloadinh.toml yet - the bridge needs slskd's api_key in it"
fi

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
  "description": "spadinh: find the playing track on Soulseek and queue it in slskd",
  "path": "$LAUNCHER",
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
