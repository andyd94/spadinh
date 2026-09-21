// dinhscogvery's triage keys on Discogs itself: `p` passes the release you're looking at, `r`
// parks it on / takes it off the Revisit list. The API calls go through the service worker.

const DCV_KEYS = { p: "pass", r: "revisit" };
const DCV_TOAST_ID = "spadinh-dcv-toast";
const DCV_TOAST_MS = 2500;

let dcvToastTimer = null;
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

function dcvIsTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tag = target.tagName.toLowerCase();

    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function dcvOnKeyDown(event) {
    // Same rules as dinhscogvery's keymap: one press per key held, no modifier chords (so ⌘R
    // reload doesn't count as `r`), and nothing while typing.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
    }

    if (dcvIsTypingTarget(event.target)) {
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
    dcvShowToast(command === "pass" ? "passing…" : "revisit…");

    chrome.runtime.sendMessage({ action: "dcv", command: command, releaseId: releaseId }, (response) => {
        dcvKeyBusy = false;

        if (chrome.runtime.lastError || !response) {
            dcvShowToast("spadinh: no reply from the extension - try reloading it");
            return;
        }

        dcvShowToast(response.text);
    });
}

function dcvShowToast(text) {
    let toast = document.getElementById(DCV_TOAST_ID);

    if (!toast) {
        toast = document.createElement("div");
        toast.id = DCV_TOAST_ID;
        toast.style.cssText = [
            "position: fixed",
            "right: 16px",
            "bottom: 16px",
            "z-index: 2147483647",
            "padding: 10px 14px",
            "border-radius: 8px",
            "background: #2d3748",
            "color: #e2e8f0",
            "font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4)",
            "transition: opacity 0.2s ease",
            "pointer-events: none"
        ].join("; ");
        document.body.appendChild(toast);
    }

    toast.textContent = text;
    toast.style.opacity = "1";

    clearTimeout(dcvToastTimer);
    dcvToastTimer = setTimeout(() => { toast.style.opacity = "0"; }, DCV_TOAST_MS);
}
