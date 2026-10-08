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


# Soulseek matches the query's words against filenames, so punctuation only ever gets in the way:
# "Klang & Spallek" wouldn't find "Klang and Spallek", and "-word" means exclude. Everything that
# isn't a letter, digit or space goes; "(Soultek Mix)" still finds "(Soultek Mix)" as two words.
def soulseek_terms(query):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]|_", " ", query)).strip()


SCRIPT = r'''
-- Qt only exposes the widgets of the tab that's showing, so each stage walks the window afresh:
-- the main "Search" tab first, then its "Manual Searches" sub-tab, then the box and button.
on firstElement(w, wantedRole, wantedName)
    tell application "System Events"
        set allElements to entire contents of w
        repeat with elRef in allElements
            set el to contents of elRef
            if role of el is wantedRole then
                if wantedName is missing value then return el
                if name of el is wantedName then return el
            end if
        end repeat
    end tell
    return missing value
end firstElement

-- Selects a tab (a radio button in SoulseekQt's tab strips) unless it's already the active one.
on selectTab(w, tabName)
    set theTab to my firstElement(w, "AXRadioButton", tabName)
    if theTab is missing value then return false
    tell application "System Events"
        if value of theTab is not 1 then
            click theTab
            delay 0.3
        end if
    end tell
    return true
end selectTab

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
            set w to window 1
        end tell
    end tell

    my selectTab(w, "Search")
    my selectTab(w, "Manual Searches")

    -- The first, and widest, combo box is the search field; the others are "search target"
    -- and saved filters.
    set searchBox to my firstElement(w, "AXComboBox", missing value)
    set searchButton to my firstElement(w, "AXButton", "Search")

    if searchBox is missing value or searchButton is missing value then
        error "couldn't find SoulseekQt's search box - is the Search tab available?"
    end if

    tell application "System Events"
        -- The combo box ignores a value set on itself; its line edit (the text field inside it)
        -- takes the text, and Search then runs it.
        set value of text field 1 of searchBox to theQuery
        delay 0.1
        click searchButton
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
                "System Settings > Privacy & Security > Accessibility, then press Shift+S again")

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
