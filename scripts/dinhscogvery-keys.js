// dinhscogvery's triage keys on Discogs itself: `p` passes the release you're looking at, `r`
// parks it on / takes it off the Revisit list. Opening a release page also marks it seen
// (viewed) in dinhscogvery. The API calls go through the service worker.

const DCV_KEYS = { p: "pass", r: "revisit" };

let dcvKeyBusy = false;

dcvKeysInit();

function dcvKeysInit() {
    if (dcvReleaseIdFromPage() === null) {
        return;
    }

    document.addEventListener("keydown", dcvOnKeyDown);
    dcvMarkViewed();
}

// The release page itself (/release/123-..., also under a locale prefix like /de/), not its
// marketplace listings: visiting a record there marks it seen in dinhscogvery, the same footprint
// its own release panel leaves. Silent either way — a release dinhscogvery doesn't carry (404),
// or an unreachable box, isn't worth a toast on every page.
function dcvMarkViewed() {
    const match = window.location.pathname.match(/^(?:\/[a-z]{2})?\/release\/(\d+)/);

    if (!match) {
        return;
    }

    chrome.runtime.sendMessage({ action: "dcv", command: "seen", releaseId: parseInt(match[1], 10) }, () => {
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
