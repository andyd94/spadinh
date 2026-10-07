#!/usr/bin/python3
# Chrome native messaging host: types a query into SoulseekQt's search box and presses Search.
#
# Chrome starts this for each message (chrome.runtime.sendNativeMessage), so it reads one
# {"query": "..."} from stdin, answers {"ok": bool, "text": "..."} and exits. The work is done by an
# AppleScript through System Events: SoulseekQt has no API, URL scheme or command line, but its
# window is a small accessibility tree, so the search field and button are found by walking it
# rather than by a nested path that would break with the next Qt build.
#
# macOS attributes the automation to Chrome, so the first run asks to let Google Chrome control the
# computer (System Settings > Privacy & Security > Accessibility). Nothing happens until that's
# allowed; the error says so.
#
# Registered by install.sh; /usr/bin/python3 because Chrome launches hosts with a minimal PATH.

import json
import re
import struct
import subprocess
import sys

OSASCRIPT_TIMEOUT_S = 30


# `-word` excludes `word` in Soulseek's query syntax, so the " - " between artist and track goes.
# Everything else is left alone: the user may well refine it in SoulseekQt's own box.
def soulseek_terms(query):
    return re.sub(r"\s+[-–—]\s+", " ", query).strip()


SCRIPT = r'''
on run argv
    set theQuery to item 1 of argv

    tell application "SoulseekQt" to activate

    tell application "System Events"
        tell process "SoulseekQt"
            -- Activation also launches the app when it's closed; give its window time to appear.
            set tries to 0
            repeat until (count of windows) > 0 or tries > 40
                delay 0.25
                set tries to tries + 1
            end repeat
            if (count of windows) = 0 then error "SoulseekQt has no window open"

            tell window 1
                set searchBox to missing value
                set searchButton to missing value
                set searchTab to missing value
                set manualTab to missing value

                -- Collected into a list first: iterating `entire contents` directly hands over
                -- "item N of entire contents of window 1" references System Events can't resolve.
                set allElements to entire contents
                repeat with elRef in allElements
                    set el to contents of elRef
                    set r to role of el
                    if r is "AXComboBox" and searchBox is missing value then
                        -- The first, and widest, combo box is the search field; the others are
                        -- "search target" and saved filters.
                        set searchBox to el
                    else if r is "AXButton" and name of el is "Search" then
                        set searchButton to el
                    else if r is "AXRadioButton" then
                        if name of el is "Search" then set searchTab to el
                        if name of el is "Manual Searches" then set manualTab to el
                    end if
                end repeat

                if searchBox is missing value or searchButton is missing value then
                    error "couldn't find SoulseekQt's search box - is the Search tab available?"
                end if

                if searchTab is not missing value and value of searchTab is not 1 then click searchTab
                if manualTab is not missing value and value of manualTab is not 1 then click manualTab

                -- The combo box ignores a value set on itself; its line edit (the text field
                -- inside it) takes the text, and Search then runs it.
                set value of text field 1 of searchBox to theQuery
                delay 0.1
                click searchButton
            end tell
        end tell
    end tell
end run
'''


def read_message():
    raw_length = sys.stdin.buffer.read(4)

    if len(raw_length) < 4:
        sys.exit(0)

    (length,) = struct.unpack("<I", raw_length)

    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send(message):
    data = json.dumps(message).encode("utf-8")

    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def describe_failure(stderr):
    text = (stderr or "").strip()

    if "assistive access" in text or "-1719" in text or "-25211" in text:
        return ("macOS won't let Chrome control SoulseekQt yet - allow Google Chrome under "
                "System Settings > Privacy & Security > Accessibility, then press Shift+A again")

    if "-1743" in text or "not permitted" in text.lower():
        return ("macOS blocked Chrome from automating SoulseekQt - allow it under "
                "System Settings > Privacy & Security > Automation")

    # osascript prefixes its own errors with the script position; keep what comes after.
    text = re.sub(r"^\d+:\d+:\s*(execution error:\s*)?", "", text)

    return "SoulseekQt search failed: " + (text or "unknown error")


def main():
    message = read_message()
    query = soulseek_terms(str(message.get("query") or ""))

    if not query:
        send({"ok": False, "text": "nothing to search for"})
        return

    try:
        result = subprocess.run(
            ["/usr/bin/osascript", "-", query],
            input=SCRIPT,
            capture_output=True,
            text=True,
            timeout=OSASCRIPT_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        send({"ok": False, "text": "SoulseekQt didn't respond in time"})
        return

    if result.returncode != 0:
        send({"ok": False, "text": describe_failure(result.stderr)})
        return

    send({"ok": True, "text": "soulseek: searching " + query})


if __name__ == "__main__":
    main()
