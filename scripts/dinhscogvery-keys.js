// dinhscogvery's triage keys on Discogs itself: `p` passes the release you're looking at, `r`
// parks it on / takes it off the Revisit list. Opening a release page also marks it seen
// (viewed) in dinhscogvery; opening a master page marks every pressing dinhscogvery holds for it
// seen. The API calls go through the service worker.

const DCV_KEYS = { p: "pass", r: "revisit" };

let dcvKeyBusy = false;

dcvKeysInit();

function dcvKeysInit() {
    dcvMarkViewed();

    if (dcvReleaseIdFromPage() === null) {
        return;
    }

    document.addEventListener("keydown", dcvOnKeyDown);
}

// The release or master page itself (/release/123-..., /master/123-..., also under a locale prefix
// like /de/), not its marketplace listings: visiting a record there marks it seen in dinhscogvery,
// the same footprint its own release panel leaves; a master page marks every pressing dinhscogvery
// holds for it. Silent either way — a release or master dinhscogvery doesn't carry (404), or an
// unreachable box, isn't worth a toast on every page. `p` and `r` stay release-only.
function dcvMarkViewed() {
    const match = window.location.pathname.match(/^(?:\/[a-z]{2})?\/(release|master)\/(\d+)/);

    if (!match) {
        return;
    }

    const message = match[1] === "master"
        ? { action: "dcv", command: "seenMaster", masterId: parseInt(match[2], 10) }
        : { action: "dcv", command: "seen", releaseId: parseInt(match[2], 10) };

    chrome.runtime.sendMessage(message, () => {
        // Read lastError so Chrome doesn't log it when the service worker is reloading.
        void chrome.runtime.lastError;
    });
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
