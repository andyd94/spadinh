// dinhscogvery's triage keys on Discogs itself: `p` passes the release you're looking at, `r`
// parks it on / takes it off the Revisit list. The API calls go through the service worker.

const DCV_KEYS = { p: "pass", r: "revisit" };

let dcvKeyBusy = false;

dcvKeysInit();

function dcvKeysInit() {
    if (dcvReleaseIdFromPage() === null) {
        return;
    }

    document.addEventListener("keydown", dcvOnKeyDown);
}

// Release pages (/release/123-Artist-Title) and a release's listings (/sell/release/123) carry
// the id in the URL; a single listing (/sell/item/456) links to its release instead.
function dcvReleaseIdFromPage() {
    const urlMatch = window.location.pathname.match(/\/release\/(\d+)/);

    if (urlMatch) {
        return parseInt(urlMatch[1], 10);
    }

    if (!/\/sell\/item\/\d+/.test(window.location.pathname)) {
        return null;
    }

    const link = document.querySelector('a[href*="/release/"]');
    const hrefMatch = link ? link.href.match(/\/release\/(\d+)/) : null;

    return hrefMatch ? parseInt(hrefMatch[1], 10) : null;
}

function dcvOnKeyDown(event) {
    // Same rules as dinhscogvery's keymap: one press per key held, no modifier chords (so ⌘R
    // reload doesn't count as `r`), and nothing while typing.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    const command = DCV_KEYS[event.key];

    if (!command || dcvKeyBusy) {
        return;
    }

    const releaseId = dcvReleaseIdFromPage();

    if (releaseId === null) {
        return;
    }

    dcvKeyBusy = true;
    spadinhShowToast(command === "pass" ? "passing…" : "revisit…");

    chrome.runtime.sendMessage({ action: "dcv", command: command, releaseId: releaseId }, (response) => {
        dcvKeyBusy = false;

        if (chrome.runtime.lastError || !response) {
            spadinhShowToast("spadinh: no reply from the extension - try reloading it");
            return;
        }

        spadinhShowToast(response.text);
    });
}
