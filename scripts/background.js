// Service worker: every dinhscogvery API call lives here. Both the popup and the content script
// on discogs.com send it messages rather than fetching themselves — a content script's fetch is
// subject to Discogs' origin (CORS), while the extension origin is covered by host_permissions.

// dinhscogvery's Tailscale Serve address, so this works from any machine on the tailnet. Serve
// terminates TLS and proxies to 127.0.0.1:8000, so dinhscogvery stays bound to localhost and
// nothing has to listen on port 8000 across interfaces. Override it in the popup's API url field.
const DCV_DEFAULT_BASE_URL = "https://ukfcp2j9w2qg.tail287e49.ts.net";
const DCV_REVISIT_SLUG = "revisit";

// How long a fetched set of passed/revisit ids stays usable before it's refetched. Triage done
// through this extension updates the cache in place (see `rememberStateChange`), so this only
// covers records triaged elsewhere — in dinhscogvery itself, or on another machine.
const DCV_SETS_TTL_MS = 10 * 60 * 1000;

class DcvError extends Error {
    constructor(status, detail) {
        super(detail);
        this.status = status;
        this.detail = detail;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "dcv") {
        return false;
    }

    runDcvCommand(message.command, message.releaseId)
        .then((text) => sendResponse({ ok: true, text: text }))
        .catch((error) => sendResponse({ ok: false, text: describeDcvError(error) }));

    // Keep the message channel open for the async response above.
    return true;
});

async function runDcvCommand(command, releaseId) {
    switch (command) {
        case "pass":
            return passRelease(releaseId);
        case "revisit":
            return toggleRevisit(releaseId);
        case "status":
            return releaseStatus(releaseId);
        default:
            throw new DcvError(0, "unknown dinhscogvery command " + command);
    }
}

// `sets` answers with data rather than a message, so it takes its own path out of the listener.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "dcvSets") {
        return false;
    }

    getDcvSets(message.force === true)
        .then((sets) => sendResponse({ ok: true, passed: sets.passed, revisit: sets.revisit }))
        .catch((error) => sendResponse({ ok: false, text: describeDcvError(error) }));

    return true;
});

async function getDcvBaseUrl() {
    const result = await chrome.storage.local.get(["dcvBaseUrl"]);
    const url = (result.dcvBaseUrl || DCV_DEFAULT_BASE_URL).trim();

    return url.replace(/\/+$/, "");
}

// The web app sends a per-session uuid so passes can be undone server-side; the extension keeps
// one persistent id so its passes land in one session rather than none.
async function getDcvSessionId() {
    const result = await chrome.storage.local.get(["dcvSessionId"]);

    if (result.dcvSessionId) {
        return result.dcvSessionId;
    }

    const sessionId = crypto.randomUUID();
    await chrome.storage.local.set({ dcvSessionId: sessionId });

    return sessionId;
}

async function dcvRequest(method, path, body) {
    const baseUrl = await getDcvBaseUrl();
    const headers = { "X-Session-Id": await getDcvSessionId() };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    let response;

    try {
        response = await fetch(baseUrl + path, {
            method: method,
            headers: headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (error) {
        throw new DcvError(0, "can't reach dinhscogvery at " + baseUrl + " - is it running?");
    }

    if (!response.ok) {
        throw new DcvError(response.status, await readDcvDetail(response));
    }

    return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

async function readDcvDetail(response) {
    try {
        const payload = await response.json();

        if (typeof payload.detail === "string") {
            return payload.detail;
        }

        if (Array.isArray(payload.detail) && payload.detail.length > 0) {
            return payload.detail[0].msg;
        }
    } catch (error) {
        // fall through to statusText below
    }

    return response.statusText;
}

async function getRevisitList() {
    const lists = (await dcvRequest("GET", "/api/lists")).data;
    const revisitList = lists.find((list) => list.slug === DCV_REVISIT_SLUG);

    if (!revisitList) {
        throw new DcvError(0, "no Revisit list in dinhscogvery");
    }

    return revisitList;
}

// Every row of `/api/export` starts with the release id; the columns after it can contain quoted
// commas, so only the leading integer is parsed. The header line has no leading digits and so
// falls out on its own.
function parseExportIds(csv) {
    const ids = [];

    for (const line of csv.split("\n")) {
        const match = line.match(/^(\d+),/);

        if (match) {
            ids.push(parseInt(match[1], 10));
        }
    }

    return ids;
}

async function exportIds(query) {
    const baseUrl = await getDcvBaseUrl();
    let response;

    try {
        response = await fetch(baseUrl + "/api/export?" + query);
    } catch (error) {
        throw new DcvError(0, "can't reach dinhscogvery at " + baseUrl + " - is it running?");
    }

    if (!response.ok) {
        throw new DcvError(response.status, await readDcvDetail(response));
    }

    return parseExportIds(await response.text());
}

// The passed and revisit id sets, from cache when it's fresh enough. `/api/export` streams the
// whole result in one request (it pages internally, capped at 50k rows), so neither set needs
// cursor handling here.
async function getDcvSets(force = false) {
    const cached = (await chrome.storage.local.get(["dcvSets"])).dcvSets;

    if (!force && cached && Date.now() - cached.fetchedAt < DCV_SETS_TTL_MS) {
        return cached;
    }

    const revisitList = await getRevisitList();
    const [passed, revisit] = await Promise.all([
        exportIds("filter=" + encodeURIComponent('{"field":"state","op":"eq","value":"passed"}') +
            "&dedup=false&exclude_passed=false"),
        exportIds("list_id=" + revisitList.id)
    ]);

    const sets = { passed: passed, revisit: revisit, fetchedAt: Date.now() };

    await chrome.storage.local.set({ dcvSets: sets });

    return sets;
}

// Keeps the cached sets honest after triage done through this extension, so a seller page reflects
// the change without waiting out the TTL.
async function rememberStateChange(releaseId, { passed, revisit }) {
    const cached = (await chrome.storage.local.get(["dcvSets"])).dcvSets;

    if (!cached) {
        return;
    }

    const apply = (ids, member) => {
        const without = ids.filter((id) => id !== releaseId);
        return member ? without.concat(releaseId) : without;
    };

    await chrome.storage.local.set({
        dcvSets: {
            passed: passed === undefined ? cached.passed : apply(cached.passed, passed),
            revisit: revisit === undefined ? cached.revisit : apply(cached.revisit, revisit),
            fetchedAt: cached.fetchedAt
        }
    });
}

async function passRelease(releaseId) {
    await dcvRequest("PUT", "/api/releases/" + releaseId + "/state", { state: "passed" });
    await rememberStateChange(releaseId, { passed: true });

    return "passed #" + releaseId;
}

// Same as dinhscogvery's `r`: park the release on Revisit, or take it off if it's already there.
async function toggleRevisit(releaseId) {
    const revisitList = await getRevisitList();
    const release = (await dcvRequest("GET", "/api/releases/" + releaseId)).data;
    const onList = release.lists.some((list) => list.id === revisitList.id);

    if (onList) {
        await dcvRequest("DELETE", "/api/lists/" + revisitList.id + "/items/" + releaseId);
        await rememberStateChange(releaseId, { revisit: false });
        return "removed #" + releaseId + " from " + revisitList.name;
    }

    await dcvRequest("POST", "/api/lists/" + revisitList.id + "/items", { release_id: releaseId });
    await rememberStateChange(releaseId, { revisit: true });
    return "added #" + releaseId + " to " + revisitList.name;
}

// Where the release already stands, e.g. "#123 · passed · Revisit".
async function releaseStatus(releaseId) {
    const release = (await dcvRequest("GET", "/api/releases/" + releaseId)).data;
    const parts = ["#" + releaseId, release.state ? release.state.state : "unseen"];

    release.lists.forEach((list) => parts.push(list.name));

    return parts.join(" · ");
}

function describeDcvError(error) {
    if (error instanceof DcvError) {
        if (error.status === 404 && /^release \d+ not found$/.test(error.detail)) {
            return "not in the dinhscogvery catalog";
        }

        return error.detail;
    }

    console.error(error);
    return "something went wrong - see the service worker console";
}
