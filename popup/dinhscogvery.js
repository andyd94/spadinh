// Popup side of the dinhscogvery buttons. The API calls themselves live in the service worker
// (scripts/background.js), shared with the `p`/`r` keys on discogs.com.

const DCV_DEFAULT_BASE_URL = "https://ukfcp2j9w2qg.tail287e49.ts.net";

document.addEventListener("DOMContentLoaded", () => {
    const baseUrlInput = document.getElementById("dcv-base-url");
    const passButton = document.getElementById("dcv-pass");
    const revisitButton = document.getElementById("dcv-revisit");

    baseUrlInput.placeholder = DCV_DEFAULT_BASE_URL;

    baseUrlInput.addEventListener("input", () => {
        chrome.storage.local.set({ dcvBaseUrl: baseUrlInput.value.trim() }).then(() => {
            console.log("Saved dinhscogvery base url as " + baseUrlInput.value);
        });
    });

    chrome.storage.local.get(["dcvBaseUrl"]).then((result) => {
        if (result.key !== null && result.dcvBaseUrl !== undefined) {
            baseUrlInput.value = result.dcvBaseUrl;
        }
    });

    passButton.addEventListener("click", () => runDcvAction("pass"));
    revisitButton.addEventListener("click", () => runDcvAction("revisit"));
    document.getElementById("dcv-status").addEventListener("click", resyncDcvSets);

    refreshDcvStatus();
});

// The cached passed/revisit sets refresh on their own every 10 minutes, and triage done through
// this extension updates them as it happens. This is the escape hatch for triage done elsewhere.
async function resyncDcvSets() {
    setDcvStatus("re-syncing…");

    const sets = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "dcvSets", force: true }, (response) => {
            resolve(chrome.runtime.lastError || !response ? null : response);
        });
    });

    if (sets === null || !sets.ok) {
        setDcvStatus(sets && sets.text ? sets.text : "re-sync failed");
        return;
    }

    const tab = await getCurrentTab();

    if (tab && tab.url && tab.url.includes("discogs.com")) {
        chrome.tabs.sendMessage(tab.id, { action: "dcvRemark" }, () => chrome.runtime.lastError);
    }

    setDcvStatus(sets.passed.length + " passed · " + sets.revisit.length + " revisit");
}

function getCurrentTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });
}

// Release pages (/release/123-Artist-Title) and a release's marketplace listings (/sell/release/123)
// carry the id in the URL. A single listing (/sell/item/456) doesn't, so fall back to the release
// link on the page. Master pages link to many releases, so they're deliberately not handled.
async function findReleaseId(tab) {
    if (!tab || !tab.url || !tab.url.includes("discogs.com")) {
        return null;
    }

    const urlMatch = tab.url.match(/\/release\/(\d+)/);

    if (urlMatch) {
        return parseInt(urlMatch[1], 10);
    }

    if (!/\/sell\/item\/\d+/.test(tab.url)) {
        return null;
    }

    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const link = document.querySelector('a[href*="/release/"]');
            return link ? link.href : null;
        }
    });

    const href = results && results[0] ? results[0].result : null;
    const hrefMatch = href ? href.match(/\/release\/(\d+)/) : null;

    return hrefMatch ? parseInt(hrefMatch[1], 10) : null;
}

function sendDcvCommand(command, releaseId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "dcv", command: command, releaseId: releaseId }, (response) => {
            if (chrome.runtime.lastError || !response) {
                resolve({ ok: false, text: "no reply from the extension - try reloading it" });
                return;
            }

            resolve(response);
        });
    });
}

async function runDcvAction(command) {
    const buttons = [document.getElementById("dcv-pass"), document.getElementById("dcv-revisit")];

    buttons.forEach((button) => button.disabled = true);

    try {
        const releaseId = await findReleaseId(await getCurrentTab());

        if (releaseId === null) {
            setDcvStatus("open a Discogs release page first");
            return;
        }

        const response = await sendDcvCommand(command, releaseId);

        setDcvStatus(response.text);

        if (response.ok) {
            await refreshDcvStatus(releaseId, false);
        }
    } finally {
        buttons.forEach((button) => button.disabled = false);
    }
}

// Shows where the current release already stands in dinhscogvery, e.g. "#123 · passed · Revisit".
async function refreshDcvStatus(releaseId, replaceStatus = true) {
    if (releaseId === undefined) {
        releaseId = await findReleaseId(await getCurrentTab());
    }

    if (releaseId === null) {
        setDcvStatus("open a Discogs release page");
        return;
    }

    const response = await sendDcvCommand("status", releaseId);

    setDcvStatus(response.text, replaceStatus);
}

function setDcvStatus(text, replace = true) {
    const status = document.getElementById("dcv-status");

    status.textContent = replace ? text : status.textContent + " (" + text + ")";
}
