// The query builder shared with the content scripts; nothing else in there runs at load.
importScripts("_shared.js");

// Service worker: every dinhscogvery API call lives here. Both the popup and the content script
// on discogs.com send it messages rather than fetching themselves — a content script's fetch is
// subject to Discogs' origin (CORS), while the extension origin is covered by host_permissions.

// dinhscogvery's production box, reachable only over the tailnet (it serves over Tailscale, so
// this works from any machine on it). Override it in the popup's API url field, e.g. with
// http://127.0.0.1:8000 for a dev server on this machine.
const DCV_DEFAULT_BASE_URL = "https://dinhscogvery.tail287e49.ts.net";

// Where dinhscogvery answers on the serving Mac itself. When the configured address can't be
// reached at all (the corporate VPN blocks Tailscale, the Mac's own tailnet IP included), requests
// go here instead; on any other machine nothing listens, so the fallback fails fast and the error
// says so.
const DCV_LOCAL_BASE_URL = "http://127.0.0.1:8000";
const DCV_REVISIT_SLUG = "revisit";

// How long a fetched set of passed/revisit ids stays usable before it's refetched. Triage done
// through this extension updates the cache in place (see `rememberStateChange`), so this only
// covers records triaged elsewhere — in dinhscogvery itself, or on another machine.
const DCV_SETS_TTL_MS = 10 * 60 * 1000;

// How long a request gets to start answering (DNS, connect, TLS, first byte) before the address
// counts as unreachable. Reading the body isn't timed: `/api/export` streams, and a long one
// isn't a sign the address is down.
const DCV_CONNECT_TIMEOUT_MS = 5 * 1000;

// Once localhost has stood in for an unreachable address, requests go straight there for this
// long rather than waiting out the timeout every time; after that the configured address is
// tried first again. Session storage outlives this service worker but not Chrome.
const DCV_LOCAL_STICKY_MS = 10 * 60 * 1000;

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

    runDcvCommand(message.command, message.releaseId, message.masterId)
        .then((text) => sendResponse({ ok: true, text: text }))
        .catch((error) => sendResponse({ ok: false, text: describeDcvError(error) }));

    // Keep the message channel open for the async response above.
    return true;
});

async function runDcvCommand(command, releaseId, masterId) {
    switch (command) {
        case "pass":
            return passRelease(releaseId);
        case "revisit":
            return toggleRevisit(releaseId);
        case "status":
            return releaseStatus(releaseId);
        case "seen":
            return markSeen(releaseId);
        case "seenMaster":
            return markMasterSeen(masterId);
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
    const headers = { "X-Session-Id": await getDcvSessionId() };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const { response, baseUrl } = await dcvFetch(path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
        throw new DcvError(response.status, await readDcvDetail(response, baseUrl));
    }

    return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

// One request to dinhscogvery, sent to the configured address or localhost (see `dcvBaseUrls`).
// Only a request that never starts getting a response - fetch rejecting, or the connect timeout -
// moves on to the next address. An HTTP error is whatever is on that address answering, and goes
// back to the caller as-is.
async function dcvFetch(path, init) {
    const configured = await getDcvBaseUrl();
    const baseUrls = await dcvBaseUrls(configured);
    let response = null;
    let baseUrl = null;

    for (const candidate of baseUrls) {
        try {
            response = await fetchWithConnectTimeout(candidate + path, init);
            baseUrl = candidate;
            break;
        } catch (error) {
            // unreachable or timed out - on to the next address
        }
    }

    if (response === null) {
        throw new DcvError(0, "can't reach dinhscogvery at " + configured +
            (baseUrls.length > 1 ? " or " + DCV_LOCAL_BASE_URL : "") + " - is it running?");
    }

    // Localhost standing in for a configured address that just failed opens the sticky window; the
    // configured address answering closes it. Localhost answering inside the window leaves it
    // alone, so the configured address gets another go when the window runs out.
    if (baseUrl === configured) {
        await chrome.storage.session.remove("dcvLocalUntil");
    } else if (baseUrls[0] === configured) {
        await chrome.storage.session.set({ dcvLocalUntil: Date.now() + DCV_LOCAL_STICKY_MS });
    }

    return { response: response, baseUrl: baseUrl };
}

// The addresses to try, in order. A configured address that is already localhost has nothing to
// fall back to; otherwise localhost goes first while a fallback is fresh, second the rest of the
// time.
async function dcvBaseUrls(configured) {
    if (isLocalBaseUrl(configured)) {
        return [configured];
    }

    const stored = await chrome.storage.session.get(["dcvLocalUntil"]);

    if (stored.dcvLocalUntil && Date.now() < stored.dcvLocalUntil) {
        return [DCV_LOCAL_BASE_URL, configured];
    }

    return [configured, DCV_LOCAL_BASE_URL];
}

function isLocalBaseUrl(baseUrl) {
    try {
        return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname);
    } catch (error) {
        return false;
    }
}

// The timer is cleared as soon as headers arrive, so only the connect is bounded.
async function fetchWithConnectTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DCV_CONNECT_TIMEOUT_MS);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Every error dinhscogvery raises carries a `detail`. A response without one didn't come from
// dinhscogvery at all — most likely something else is answering on that address, which is easy to
// hit when the API url points at a bare port. Say which address replied rather than "Bad Request".
async function readDcvDetail(response, baseUrl) {
    try {
        const payload = await response.json();

        if (typeof payload.detail === "string") {
            return payload.detail;
        }

        if (Array.isArray(payload.detail) && payload.detail.length > 0) {
            return payload.detail[0].msg;
        }
    } catch (error) {
        // fall through to the not-dinhscogvery message below
    }

    return "HTTP " + response.status + " from " + baseUrl + " - that isn't dinhscogvery answering";
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
    const { response, baseUrl } = await dcvFetch("/api/export?" + query);

    if (!response.ok) {
        throw new DcvError(response.status, await readDcvDetail(response, baseUrl));
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

// Opening a release page on Discogs records it as seen (viewed), like opening it in dinhscogvery:
// bumps seen_count and last_seen_at, keeps first_seen_at.
async function markSeen(releaseId) {
    const seen = (await dcvRequest("POST", "/api/releases/" + releaseId + "/seen")).data;

    // Rows cached for artist/label/search pages pick it up now rather than after their TTL.
    for (const entry of dcvRowsCache.values()) {
        entry.rows.forEach((row) => {
            if (row.id === releaseId) {
                row.seen = true;
            }
        });
    }

    return "seen #" + releaseId + " (" + seen.seen_count + "x)";
}

// Opening a master page on Discogs marks every pressing dinhscogvery holds for it seen, in
// one call (`POST /api/masters/{id}/seen`); same bump as `markSeen` on each.
async function markMasterSeen(masterId) {
    const seen = (await dcvRequest("POST", "/api/masters/" + masterId + "/seen")).data;

    for (const entry of dcvRowsCache.values()) {
        entry.rows.forEach((row) => {
            if (row.masterId === masterId) {
                row.seen = true;
            }
        });
    }

    const times = seen.seen_count_min === seen.seen_count_max
        ? seen.seen_count_min + "x"
        : seen.seen_count_min + "-" + seen.seen_count_max + "x";

    return "seen master #" + masterId + " (" + seen.release_ids.length + " pressings, " + times + ")";
}

// Where the release already stands, e.g. "#123 · passed · Revisit".
async function releaseStatus(releaseId) {
    const release = (await dcvRequest("GET", "/api/releases/" + releaseId)).data;
    const parts = ["#" + releaseId, release.state ? release.state.state : "unseen"];

    release.lists.forEach((list) => parts.push(list.name));

    return parts.join(" · ");
}

// --- Row info for artist, label and search pages -------------------------------------------------
//
// dinhscogvery-rows.js decorates each release row of a Discogs artist or label page, and each
// card of a search page, with what dinhscogvery knows about it. An artist or label is one
// `/api/query` filtered on its id (up to 1000 releases a page, a few pages at most). Search
// results are anyone's, so they're looked up by the release and master ids on the page: through
// `/api/query`'s `release_id` / `master_id` clauses when dinhscogvery has them, else one
// `/api/releases/{id}` at a time, which can't resolve masters. Rows are keyed by release id and,
// for grouped master rows, by master id.

const DCV_ROWS_PAGE_LIMIT = 1000;
const DCV_ROWS_MAX_PAGES = 5;
const DCV_ROWS_TTL_MS = 10 * 60 * 1000;
const DCV_ROWS_DETAIL_CONCURRENCY = 4;

// Per artist/label, and per release/master id, for as long as this service worker lives; a
// reload of the page within the TTL doesn't re-query.
const dcvRowsCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "dcvRows") {
        return false;
    }

    const rows = message.kind === "ids"
        ? getDcvRowsForIds(message.releaseIds || [], message.masterIds || [])
        : getDcvRows(message.kind, message.id, message.force === true);

    rows
        .then((rows) => sendResponse({ ok: true, rows: rows }))
        .catch((error) => sendResponse({ ok: false, text: describeDcvError(error) }));

    return true;
});

async function getDcvRows(kind, id, force) {
    const key = kind + ":" + id;
    const cached = dcvRowsCache.get(key);

    if (!force && cached && Date.now() - cached.fetchedAt < DCV_ROWS_TTL_MS) {
        return cached.rows;
    }

    // A seller page is the listings dinhscogvery has mirrored for that username (`seller_has`);
    // an unmirrored seller simply yields nothing.
    const field = kind === "seller" ? "seller_has" : (kind === "label" ? "label_id" : "artist_id");
    const revisitList = await getRevisitList();
    const rows = await queryDcvRows({ field: field, op: "eq", value: id }, revisitList.id);

    dcvRowsCache.set(key, { rows: rows, fetchedAt: Date.now() });

    return rows;
}

// Every release matching `filter`, paged.
async function queryDcvRows(filter, revisitListId) {
    const rows = [];
    let cursor = null;

    for (let page = 0; page < DCV_ROWS_MAX_PAGES; page++) {
        const data = (await dcvRequest("POST", "/api/query", {
            filter: filter,
            sort: "year_desc",
            cursor: cursor,
            limit: DCV_ROWS_PAGE_LIMIT,
            dedup: false,
            exclude_passed: false
        })).data;

        data.items.forEach((item) => rows.push(slimDcvRow(item, revisitListId)));
        cursor = data.next_cursor;

        if (!cursor) {
            break;
        }
    }

    return rows;
}

// Search cards: whatever of the ids isn't cached is fetched, and the rows for all of them go back.
async function getDcvRowsForIds(releaseIds, masterIds) {
    const now = Date.now();
    const fresh = (key) => {
        const cached = dcvRowsCache.get(key);
        return cached && now - cached.fetchedAt < DCV_ROWS_TTL_MS ? cached.rows : null;
    };
    const wantedReleases = releaseIds.filter((id) => fresh("release:" + id) === null);
    const wantedMasters = masterIds.filter((id) => fresh("master:" + id) === null);

    if (wantedReleases.length > 0 || wantedMasters.length > 0) {
        const revisitList = await getRevisitList();
        const fetched = await fetchDcvRowsForIds(wantedReleases, wantedMasters, revisitList.id);
        const byRelease = new Map();
        const byMaster = new Map();

        for (const row of fetched.rows) {
            byRelease.set(row.id, [row]);

            if (row.masterId) {
                byMaster.set(row.masterId, (byMaster.get(row.masterId) || []).concat(row));
            }
        }

        // Genuine misses are cached as empty too, so a card dinhscogvery doesn't know isn't asked
        // again; an id that got no answer (`unresolved`) is left out, to be asked next time.
        const remember = (key, rows) => {
            if (!fetched.unresolved.has(key)) {
                dcvRowsCache.set(key, { rows: rows, fetchedAt: now });
            }
        };

        wantedReleases.forEach((id) => remember("release:" + id, byRelease.get(id) || []));
        wantedMasters.forEach((id) => remember("master:" + id, byMaster.get(id) || []));
    }

    const rows = [];
    const seen = new Set();
    const take = (key) => {
        for (const row of fresh(key) || []) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                rows.push(row);
            }
        }
    };

    releaseIds.forEach((id) => take("release:" + id));
    masterIds.forEach((id) => take("master:" + id));

    return rows;
}

// The id clauses are the way: one query for the lot, masters included. A dinhscogvery without
// them answers 422 (unknown field), and then it's one release at a time.
async function fetchDcvRowsForIds(releaseIds, masterIds, revisitListId) {
    const clauses = [];

    if (releaseIds.length > 0) {
        clauses.push({ field: "release_id", op: "in", value: releaseIds });
    }

    if (masterIds.length > 0) {
        clauses.push({ field: "master_id", op: "in", value: masterIds });
    }

    try {
        return { rows: await queryDcvRows(clauses.length === 1 ? clauses[0] : { or: clauses }, revisitListId), unresolved: new Set() };
    } catch (error) {
        if (!(error instanceof DcvError) || error.status !== 422) {
            throw error;
        }
    }

    const fallback = await fetchDcvReleasesOneByOne(releaseIds, revisitListId);

    // A master can't be looked up this way: it's answered only by whichever of its pressings
    // happen to be on the page. So it's never remembered as a miss.
    masterIds.forEach((id) => fallback.unresolved.add("master:" + id));

    return fallback;
}

// `unresolved` holds the cache keys of ids that got no answer - a fetch that failed for any
// reason but "not in the catalog" - so the caller doesn't remember them as misses: a page loaded
// while the box was restarting would otherwise stay bare for ten minutes.
async function fetchDcvReleasesOneByOne(releaseIds, revisitListId) {
    const queue = releaseIds.slice();
    const rows = [];
    const unresolved = new Set();

    const worker = async () => {
        while (queue.length > 0) {
            const id = queue.shift();

            try {
                rows.push(slimDcvDetail((await dcvRequest("GET", "/api/releases/" + id)).data, revisitListId));
            } catch (error) {
                // Not in the catalog is the common case on a search page; anything else still
                // shouldn't take the rest of the page down with it.
                if (!(error instanceof DcvError) || error.status !== 404) {
                    console.warn("Spadinh: release " + id, describeDcvError(error));
                    unresolved.add("release:" + id);
                }
            }
        }
    };

    await Promise.all(Array.from({ length: DCV_ROWS_DETAIL_CONCURRENCY }, worker));

    return { rows: rows, unresolved: unresolved };
}

// `/api/releases/{id}` answers in a different shape from a query item: state and lists are
// objects, and the rest is the same.
function slimDcvDetail(detail, revisitListId) {
    return slimDcvRow({
        id: detail.id,
        master_id: detail.master_id,
        community: detail.community,
        styles: detail.styles,
        video_count: detail.video_count,
        master_video_count: detail.master_video_count,
        instrumental_track_count: detail.instrumental_track_count,
        track_count: detail.track_count,
        state: detail.state ? detail.state.state : "unseen",
        seen: detail.seen !== null && detail.seen !== undefined,
        in_lists: (detail.lists || []).map((list) => list.id),
        taste_score: detail.taste_score,
        taste_pct: detail.taste_pct,
        similarity: detail.similarity
    }, revisitListId);
}

// Just what the page shows; a label page can run to thousands of rows.
function slimDcvRow(item, revisitListId) {
    const community = item.community || {};

    return {
        id: item.id,
        masterId: item.master_id,
        have: community.have,
        want: community.want,
        rating: community.rating_avg,
        ratingCount: community.rating_count,
        styles: item.styles || [],
        videos: (item.video_count || 0) + (item.master_video_count || 0),
        instrumentals: item.instrumental_track_count || 0,
        tracks: item.track_count || 0,
        state: item.state,
        seen: item.seen === true,
        revisit: (item.in_lists || []).includes(revisitListId),
        // `taste_pct` is the per-release taste score (the one `sort: taste_desc` orders by) as a
        // 0-100 percentile, with the raw `taste_score` kept for the hover; without one only a
        // `similar_to_*` query fills `similarity`, and a plain artist/label query has neither, so
        // the badge stays off.
        ...dcvTaste(item)
    };
}

function dcvTaste(item) {
    const why = item.similarity ? item.similarity.why : [];

    if (typeof item.taste_pct === "number") {
        const raw = typeof item.taste_score === "number" ? "taste score " + item.taste_score : "";
        return { taste: item.taste_pct, tasteWhy: [raw, ...why].filter(Boolean) };
    }

    const score = item.similarity && typeof item.similarity.score === "number" ? item.similarity.score : null;
    return { taste: score, tasteWhy: why };
}

function describeDcvError(error) {
    if (error instanceof DcvError) {
        if (error.status === 404 && /^(release|master) \d+ not found$/.test(error.detail)) {
            return "not in the dinhscogvery catalog";
        }

        return error.detail;
    }

    console.error(error);
    return "something went wrong - see the service worker console";
}

// --- Liking a Discogs-embedded video on YouTube -------------------------------------------------
//
// An embedded player has no like button. The embed frame can still like in place by replaying the
// button's own internal request (`likeInEmbedFrame`); when it can't, the video is opened on
// youtube.com in a background tab (the user stays on Discogs), where youtube-keys.js presses like
// and reports back, and the tab is closed again either way. Progress
// and the result go to the originating tab as `spadinhToast` messages, which the Discogs script
// shows as toasts — the request can come from the embed iframe, whose own toast would be stuck
// inside the player.

const YT_LIKE_LOAD_TIMEOUT_MS = 20 * 1000;
const YT_LIKE_SEND_ATTEMPTS = 10;

// Originating tab ids with a like in flight, so a second `a` while one is running does nothing.
const ytLikesInFlight = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytLike") {
        return false;
    }

    const originTabId = sender.tab ? sender.tab.id : null;

    if (ytLikesInFlight.has(originTabId)) {
        sendResponse({ ok: false, text: "already liking that one…" });
        return false;
    }

    ytLikesInFlight.add(originTabId);

    resolveCurrentVideoId(originTabId, message.videoId)
        .then((videoId) => {
            if (!videoId) {
                throw new Error("no video playing on this page");
            }

            notifyPage(originTabId, "liking on YouTube…");

            return likeInEmbedFrame(originTabId, videoId).catch((error) => {
                notifyPage(originTabId, "player couldn't like (" + error.message + ") - trying a watch page…");
                return likeOnYouTube(videoId);
            });
        })
        .then((text) => notifyPage(originTabId, text))
        .catch((error) => notifyPage(originTabId, error.message))
        .finally(() => ytLikesInFlight.delete(originTabId));

    sendResponse({ ok: true });
    return false;
});

// The embed frame knows which video is actually loaded, and its title; the page around it only
// has a guess. The player's own API is asked first (`readPlayerState`, run in the frame's main
// world where it lives): it tracks videos switched through the IFrame API and says whether the
// video is playing, so with several embeds the playing one wins. The content script's answer
// (youtube-embed-keys.js, `ytCurrentVideoId`) is the fallback, scraped from the player's links.
// `null` when nothing answers: no embed mounted, or a page without our scripts.
async function askEmbedFrame(tabId) {
    if (tabId === null) {
        return null;
    }

    const fromPlayer = await askPlayerApi(tabId);

    if (fromPlayer) {
        return fromPlayer;
    }

    try {
        const answer = await chrome.tabs.sendMessage(tabId, { action: "ytCurrentVideoId" });

        return answer && answer.videoId ? answer : null;
    } catch (error) {
        return null;
    }
}

async function askPlayerApi(tabId) {
    try {
        const frames = (await chrome.webNavigation.getAllFrames({ tabId: tabId })) || [];
        const frameIds = frames
            .filter((frame) => /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(frame.url))
            .map((frame) => frame.frameId);

        if (frameIds.length === 0) {
            return null;
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: frameIds },
            func: readPlayerState,
            world: "MAIN"
        });
        const states = results.map((result) => result.result).filter((state) => state && state.videoId);

        return states.find((state) => state.playing) || states.find((state) => state.started) || states[0] || null;
    } catch (error) {
        return null;
    }
}

// Runs in an embed frame's main world. `#movie_player` is the player element; `getVideoData` is
// the IFrame API's view of what's loaded right now.
function readPlayerState() {
    const player = document.getElementById("movie_player");
    const data = player && typeof player.getVideoData === "function" ? player.getVideoData() : null;
    const video = document.querySelector("video");

    if (!data || !data.video_id) {
        return null;
    }

    return {
        videoId: data.video_id,
        title: data.title || "",
        playing: !!video && !video.paused && !video.ended,
        started: !!video && video.currentTime > 0,
        duration: video && isFinite(video.duration) ? video.duration : 0
    };
}

// --- Downloading ---------------------------------------------------------------------------------
//
// Shift+D on a Discogs page, in its player, or on YouTube: the tune is added to Downloadinh's
// queue (github.com/andyd94/downloadinh, `downloadinh serve`, this Mac only). Downloadinh does
// the rest - working out artist and title, Soulseek through slskd, DeezLoadApp if that has no
// lossless copy, the fake-lossless check, AIFF conversion and the import into Music - and shows
// it all on its own page. From here the tune is handed over and then watched for a while, so the
// toast can say how it's going and how it ended.
//
// What's handed over is what was seen, not a guess at "artist - track": the title untouched, the
// channel as a channel, the description, link and length (`resolveSearch`'s `item`). Downloadinh
// has the one cleaner, checks the name against Spotify, and holds a doubtful one on its page for
// a pick rather than searching for the wrong thing.

const DOWNLOADINH_URL = "http://127.0.0.1:5031";
const DOWNLOADINH_POLL_MS = 2000;
const DOWNLOADINH_WATCH_MS = 20 * 60 * 1000;
const DOWNLOADINH_CLEAN_TIMEOUT_MS = 1500;
const DOWNLOADINH_DESCRIPTION_MAX = 5000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "downloadTrack") {
        return false;
    }

    const originTabId = sender.tab ? sender.tab.id : null;

    resolveSearch(originTabId, message, senderOnDiscogs(sender))
        .then((found) => {
            if (!found.item) {
                notifyPage(originTabId, "nothing playing and nothing highlighted");
                return;
            }

            return queueInDownloadinh(found.item, found.query).then((queued) => {
                notifyPage(originTabId, "downloadinh: queued " + queued.line + "…");

                return watchDownloadinhJob(queued.id, (text) => notifyPage(originTabId, text));
            });
        })
        .catch((error) => notifyPage(originTabId, error.message));

    sendResponse({ ok: true });
    return false;
});

async function downloadinhFetch(path, body, timeoutMs) {
    let response;

    try {
        const options = body === undefined ? {} : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        };

        if (timeoutMs) {
            options.signal = AbortSignal.timeout(timeoutMs);
        }

        response = await fetch(DOWNLOADINH_URL + path, options);
    } catch (error) {
        throw new Error("downloadinh isn't running - start it with: downloadinh serve");
    }

    if (!response.ok) {
        throw new Error("downloadinh answered " + response.status + " to " + path);
    }

    return response.json();
}

// Resolves with `{ id, line }`: the new job and the name Downloadinh settled on for it. A tune
// already waiting in its queue is turned down, and it says so.
//
// A Downloadinh from before it took raw items ignores them and adds nothing; it gets `query`,
// Spadinh's own "artist - track" guess, as a plain line instead, as it always did.
async function queueInDownloadinh(item, query) {
    let answer = await downloadinhFetch("/api/add", { origin: "Spadinh", items: [item] });
    let line = answer.items && answer.items[0] ? answer.items[0].line : "";

    if (!(answer.ids && answer.ids.length) && !(answer.rejected && answer.rejected.length) && query) {
        answer = await downloadinhFetch("/api/add", { origin: "Spadinh", lines: [query] });
        line = query;
    }

    if (answer.ids && answer.ids.length) {
        return { id: answer.ids[0], line: line || query || item.title };
    }

    const rejected = answer.rejected && answer.rejected[0];
    const what = (rejected && rejected.line) || query || item.title;

    throw new Error("downloadinh: not queued, " + (rejected ? rejected.reason : "no reason given") + " (" + what + ")");
}

// "Artist - Title (Mix)" from Downloadinh's cleaner, the same one a download goes through, or ""
// when it isn't running, is too old to have one, or makes nothing of the title. Nothing is queued.
async function cleanViaDownloadinh(item) {
    try {
        const answer = await downloadinhFetch("/api/clean", item, DOWNLOADINH_CLEAN_TIMEOUT_MS);

        return answer && typeof answer.query === "string" ? answer.query.trim() : "";
    } catch (error) {
        return "";
    }
}

// Follows one job on Downloadinh's list, reporting each change of stage and then the outcome.
// Tunes are taken one at a time and a download can sit in someone's queue, so this gives up
// quietly after a while; the page at DOWNLOADINH_URL has the rest. The extension call each round
// is what keeps the service worker from being put to sleep between polls.
async function watchDownloadinhJob(jobId, report) {
    const deadline = Date.now() + DOWNLOADINH_WATCH_MS;
    let last = "";

    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, DOWNLOADINH_POLL_MS));
        await chrome.runtime.getPlatformInfo();

        let state;

        try {
            state = await downloadinhFetch("/api/state");
        } catch (error) {
            report("downloadinh stopped answering - the tune stays in its queue");
            return;
        }

        const jobs = state.jobs || [];
        const job = jobs.find((candidate) => candidate.id === jobId);

        if (!job) {
            return;
        }

        // Anything else is an outcome, "choose" included: Downloadinh is holding the tune for a pick.
        if (job.status !== "queued" && job.status !== "working") {
            report(downloadinhOutcome(job));
            return;
        }

        const text = downloadinhProgress(job, jobs);

        if (text !== last) {
            last = text;
            report(text);
        }
    }
}

// Ends in "…" so the toast stays up until the next one replaces it.
function downloadinhProgress(job, jobs) {
    const tune = job.tune || job.line;

    if (job.status === "queued") {
        const ahead = jobs.indexOf(job) - jobs.findIndex((other) => other.status === "queued" || other.status === "working");

        return "downloadinh: " + tune + " - waiting behind " + ahead + " other" + (ahead === 1 ? "" : "s") + "…";
    }

    // Whole tens only, or every poll would be a new toast.
    const percent = typeof job.progress === "number" ? " " + Math.floor(job.progress * 10) * 10 + "%" : "";

    return "downloadinh: " + tune + " - " + (job.detail || job.stage || "starting") + percent + "…";
}

function downloadinhOutcome(job) {
    const tune = job.tune || job.line;

    if (job.status === "done") {
        const what = [job.quality, job.source ? "from " + job.source : "", job.file ? "- " + job.file : ""]
            .filter(Boolean).join(" ");
        const flags = job.flags && job.flags.length ? " (check: " + job.flags.join("; ") + ")" : "";

        return "downloadinh: got " + tune + (what ? " - " + what : "") + (job.detail ? " - " + job.detail : "") + flags;
    }

    if (job.status === "choose") {
        // The first sentence of the reason; the page has the rest, and the suggestions.
        const why = (job.detail || "").replace(/^Not searched:\s*/i, "").split(/\.\s/)[0].replace(/\.$/, "");

        return "downloadinh: needs a pick for " + tune + (why ? " (" + why + ")" : "") + " - open localhost:5031";
    }

    if (job.status === "missing") {
        return "downloadinh: couldn't find " + tune + " - near misses and store links are on its page";
    }

    return "downloadinh: " + tune + " failed" + (job.detail ? " - " + job.detail : "");
}

async function resolveCurrentVideoId(tabId, pageGuess) {
    const embed = await askEmbedFrame(tabId);

    return embed ? embed.videoId : pageGuess;
}

// `s`: a Google search for the video as "artist - track", opened from here so an iframe never has
// to open a popup itself. The name comes from Downloadinh's cleaner when it's running, so `s` and
// Shift+D agree on what the tune is called; Spadinh's own guess is the fallback, and `s` works
// without Downloadinh.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytSearch") {
        return false;
    }

    const originTabId = sender.tab ? sender.tab.id : null;

    resolveSearch(originTabId, message, senderOnDiscogs(sender))
        .then(async (found) => {
            const query = (found.item && await cleanViaDownloadinh(found.item)) || found.query;

            if (!query) {
                notifyPage(originTabId, "nothing playing and nothing highlighted");
                return;
            }

            notifyPage(originTabId, "searching: " + query);
            return chrome.tabs.create({ url: "https://www.google.com/search?q=" + encodeURIComponent(query) });
        })
        .catch((error) => notifyPage(originTabId, error.message));

    sendResponse({ ok: true });
    return false;
});

// What `s` searches for and Shift+D downloads, two ways: `item`, what was seen, for Downloadinh to
// make a name of (null when there's nothing to go on), and `query`, Spadinh's own "artist - track"
// guess, for when Downloadinh can't be asked.
//
// A playing video wins; otherwise text highlighted on the page, so a tracklist line can be
// searched without playing it; otherwise whatever video is loaded (paused counts), or the page's
// guess. `message.playing` covers pages the player probe can't see into: YouTube pages, and the
// embed frame answering for itself.
//
// In `query`, a highlight that carries no " - " of its own gets an artist in front, like a video
// title would: the one the sender gave (the channel on YouTube, the release artist on Discogs),
// or, when the key was pressed inside the player and the embed frame knows no artist, the Discogs
// page's own heading. In `item` nothing is put in front of anything: the channel goes as
// `channel`, and `artist` is only ever the Discogs release artist, which is known to be one.
async function resolveSearch(tabId, message, onDiscogs) {
    const embed = await askEmbedFrame(tabId);
    const playing = (embed && embed.playing) || message.playing === true;
    const page = !playing || onDiscogs ? await readPageContext(tabId) : null;
    const base = { source: onDiscogs ? "Discogs" : "YouTube" };

    if (onDiscogs && page.releaseArtist) {
        base.artist = page.releaseArtist;
    }

    if (!onDiscogs && message.channel) {
        base.channel = message.channel;
    }

    if (!playing) {
        const selection = spadinhSelectionTerms(page.selection);

        if (selection) {
            return {
                query: spadinhSearchQuery(selection, message.artist || (onDiscogs ? page.artist : "")),
                // Less the tracklist position ("A2") and Discogs' "(2)", which Spadinh knows for
                // what they are; nothing else about the text is second-guessed.
                item: Object.assign({ title: selection }, base)
            };
        }
    }

    const title = (embed && embed.title) || message.title || "";

    // A Discogs page with no video and no highlight: the record itself, "Artist - Title".
    if (!title && onDiscogs && page.releaseTitle) {
        return {
            query: spadinhSearchQuery(page.releaseTitle, page.artist),
            item: Object.assign({ title: page.releaseTitle }, base)
        };
    }

    if (!title) {
        return { query: "", item: null };
    }

    // The rest describes the video itself, so it only goes with the video's own title.
    const item = Object.assign({ title: title }, base);
    const videoId = embed && embed.videoId;
    const url = message.url || (videoId ? "https://www.youtube.com/watch?v=" + videoId : "");
    const duration = Math.round(Number(message.duration || (embed && embed.duration) || 0));

    if (message.description) {
        item.description = String(message.description).slice(0, DOWNLOADINH_DESCRIPTION_MAX);
    }

    if (url) {
        item.url = url;
    }

    if (duration > 0) {
        item.duration = duration;
    }

    return { query: spadinhSearchQuery(title, message.artist || ""), item: item };
}

function senderOnDiscogs(sender) {
    try {
        return /(^|\.)discogs\.com$/.test(new URL(sender.tab.url).hostname);
    } catch (error) {
        return false;
    }
}

// The top frame's selection and its "Artist – Title" heading split in two, whichever frame the
// key was pressed in - with the player focused, the highlight is still on the page around it.
// Mirrors discogs-video-keys.js's heading reading, which can't be called from here.
async function readPageContext(tabId) {
    const empty = { selection: "", artist: "", releaseArtist: "", releaseTitle: "" };

    if (tabId === null) {
        return empty;
    }

    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                const heading = document.querySelector("h1");
                const text = heading ? heading.textContent.replace(/\s+/g, " ").trim() : "";
                const match = text.match(/^(.+?)\s[–—-]\s(.+)$/);

                return {
                    selection: String(window.getSelection ? window.getSelection() : ""),
                    onDiscogs: /(^|\.)discogs\.com$/.test(window.location.hostname),
                    artist: match ? match[1].trim() : "",
                    releaseTitle: match ? match[2].trim() : text
                };
            }
        });
        const page = result && result.result ? result.result : empty;

        return {
            selection: page.selection || "",
            artist: spadinhArtistOrNone(page.artist),
            // As Discogs prints it, less the "(2)" it numbers namesakes with. "Various" stays:
            // Downloadinh knows to ignore it.
            releaseArtist: page.onDiscogs ? (page.artist || "").replace(/\s*\(\d+\)$/, "") : "",
            releaseTitle: page.releaseTitle || ""
        };
    } catch (error) {
        return empty;
    }
}

function notifyPage(tabId, text) {
    if (tabId === null) {
        return;
    }

    // Goes to every frame of the tab; only the top-level Discogs script listens for it.
    chrome.tabs.sendMessage(tabId, { action: "spadinhToast", text: text }).catch(() => {});
}

// The embed frame can like in place (youtube-embed-keys.js, `ytLikeInFrame`): a youtube.com origin
// with the user's cookies, no tab involved. Anything short of a clear success — no player frame
// mounted, signed out in the frame, YouTube rejecting the undocumented request — is thrown, and
// the caller takes the watch-page route instead.
async function likeInEmbedFrame(tabId, videoId) {
    if (tabId === null) {
        throw new Error("no page to ask");
    }

    let answer;

    try {
        answer = await chrome.tabs.sendMessage(tabId, { action: "ytLikeInFrame", videoId: videoId });
    } catch (error) {
        throw new Error("no player frame");
    }

    if (!answer) {
        throw new Error("no player frame");
    }

    if (!answer.ok) {
        throw new Error(answer.text);
    }

    return "liked on YouTube: " + (answer.title || videoId);
}

async function likeOnYouTube(videoId) {
    return askWatchPage(videoId, "ytAutoLike");
}

// Opens the video on youtube.com in a background tab, asks youtube-keys.js there to do `action`,
// and closes the tab again either way.
async function askWatchPage(videoId, action) {
    const tab = await chrome.tabs.create({ url: "https://www.youtube.com/watch?v=" + videoId, active: false });

    try {
        await waitForTabLoad(tab.id);

        const response = await sendToTabWithRetry(tab.id, { action: action });

        if (!response || !response.ok) {
            throw new Error(response ? response.text : "no reply from the YouTube tab");
        }

        return response.text;
    } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
    }
}

// --- Saving a Discogs-embedded video to the Downloads playlist ----------------------------------
//
// `d`: the same route as a like. The embed frame adds it in place through YouTube's internal API
// (yt-innertube.js, `ytSaveInFrame`), creating the playlist on first use; failing that, a
// background watch page does it (`ytAutoSave`). Toasts land on the Discogs page.

const ytSavesInFlight = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytSave") {
        return false;
    }

    const originTabId = sender.tab ? sender.tab.id : null;

    if (ytSavesInFlight.has(originTabId)) {
        sendResponse({ ok: false, text: "already adding that one…" });
        return false;
    }

    ytSavesInFlight.add(originTabId);

    resolveCurrentVideoId(originTabId, message.videoId)
        .then((videoId) => {
            if (!videoId) {
                throw new Error("no video playing on this page");
            }

            notifyPage(originTabId, "adding to Downloads…");

            return saveInEmbedFrame(originTabId, videoId).catch((error) => {
                notifyPage(originTabId, "player couldn't add it (" + error.message + ") - trying a watch page…");
                return askWatchPage(videoId, "ytAutoSave");
            });
        })
        .then((text) => notifyPage(originTabId, text))
        .catch((error) => notifyPage(originTabId, error.message))
        .finally(() => ytSavesInFlight.delete(originTabId));

    sendResponse({ ok: true });
    return false;
});

async function saveInEmbedFrame(tabId, videoId) {
    if (tabId === null) {
        throw new Error("no page to ask");
    }

    let answer;

    try {
        answer = await chrome.tabs.sendMessage(tabId, { action: "ytSaveInFrame", videoId: videoId });
    } catch (error) {
        throw new Error("no player frame");
    }

    if (!answer) {
        throw new Error("no player frame");
    }

    if (!answer.ok) {
        throw new Error(answer.text);
    }

    return ytSaveResultText(answer.result, answer.title || videoId);
}

function waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            reject(new Error("YouTube took too long to load"));
        }, YT_LIKE_LOAD_TIMEOUT_MS);

        function done() {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
        }

        function onUpdated(updatedTabId, info) {
            if (updatedTabId === tabId && info.status === "complete") {
                done();
            }
        }

        chrome.tabs.onUpdated.addListener(onUpdated);

        // In case the load finished before the listener went on.
        chrome.tabs.get(tabId).then((current) => {
            if (current.status === "complete") {
                done();
            }
        }).catch(() => {});
    });
}

// The content script lands at document_idle, which can trail the tab's "complete" status by a
// beat; a send before it's there rejects, so try again rather than give up.
async function sendToTabWithRetry(tabId, message) {
    for (let attempt = 0; attempt < YT_LIKE_SEND_ATTEMPTS; attempt++) {
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (error) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    throw new Error("the YouTube tab never answered");
}


// --- Picking up new code ---------------------------------------------------------------------------
//
// The extension is loaded unpacked from a git checkout, and a `git pull` there changes nothing
// Chrome is running until the extension is reloaded and its tabs refreshed. This does both: every
// half minute the files on disk are fingerprinted, and when they no longer match what was loaded
// the extension reloads itself, then refreshes the Discogs and YouTube tabs so they run the new
// content scripts. A tab that's playing sound is left alone until it stops, so a pull never cuts
// off a tune.

const SELF_RELOAD_ALARM = "spadinhSelfReload";
const SELF_RELOAD_SETTLE_MS = 3000;
const SELF_RELOAD_TAB_URLS = ["*://*.discogs.com/*", "*://*.youtube.com/*"];

chrome.alarms.create(SELF_RELOAD_ALARM, { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SELF_RELOAD_ALARM) {
        checkForNewCode().catch(() => {});
    }
});

// Fires after every load of the extension, a reload from here included: what's on disk now is
// what's running, and open tabs still hold the content scripts of the load before.
chrome.runtime.onInstalled.addListener(() => {
    adoptLoadedCode().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.audible === false || changeInfo.status === "loading") {
        settleStaleTab(tabId, changeInfo.status === "loading").catch(() => {});
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    settleStaleTab(tabId, true).catch(() => {});
});

// Every file the manifest and the popup name, hashed together. Unpacked, these are read straight
// off the disk each time.
async function codeFingerprint() {
    const manifest = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
    const files = new Set(["manifest.json", manifest.background.service_worker, manifest.action.default_popup,
        "scripts/_shared.js", "popup/popup.js", "popup/dinhscogvery.js", "css/popup.css"]);

    for (const entry of manifest.content_scripts || []) {
        for (const file of (entry.js || []).concat(entry.css || [])) {
            files.add(file);
        }
    }

    const parts = [];

    for (const file of Array.from(files).sort()) {
        const response = await fetch(chrome.runtime.getURL(file), { cache: "no-store" });

        parts.push(file + "\n" + (response.ok ? await response.text() : "missing"));
    }

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n\u0000\n")));

    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function adoptLoadedCode() {
    await chrome.storage.local.set({ loadedCode: await codeFingerprint() });
    await refreshTabsForNewCode();
}

async function checkForNewCode() {
    const stored = await chrome.storage.local.get(["loadedCode", "reloadedForCode"]);
    const current = await codeFingerprint();

    if (!stored.loadedCode) {
        await chrome.storage.local.set({ loadedCode: current });
        return;
    }

    if (current === stored.loadedCode) {
        return;
    }

    // Already reloaded for exactly these files and still here comparing: the load wasn't recorded.
    // Record it now rather than reload for ever.
    if (current === stored.reloadedForCode) {
        await adoptLoadedCode();
        return;
    }

    // A pull writes its files one after another; wait for it to finish before loading them.
    await new Promise((resolve) => setTimeout(resolve, SELF_RELOAD_SETTLE_MS));

    if (await codeFingerprint() !== current) {
        return;
    }

    await chrome.storage.local.set({ reloadedForCode: current });
    chrome.runtime.reload();
}

// Quiet tabs are refreshed now; ones playing sound are remembered and refreshed when they stop
// (`settleStaleTab`). Until then their keys do nothing, the old content script having lost its
// extension.
async function refreshTabsForNewCode() {
    const tabs = await chrome.tabs.query({ url: SELF_RELOAD_TAB_URLS });
    const waiting = [];

    for (const tab of tabs) {
        if (tab.audible) {
            waiting.push(tab.id);
        } else {
            chrome.tabs.reload(tab.id).catch(() => {});
        }
    }

    await chrome.storage.local.set({ staleTabs: waiting });
}

// `gone`: the tab closed or is loading afresh on its own, so it's no longer stale either way.
async function settleStaleTab(tabId, gone) {
    const stored = await chrome.storage.local.get(["staleTabs"]);
    const waiting = stored.staleTabs || [];

    if (!waiting.includes(tabId)) {
        return;
    }

    await chrome.storage.local.set({ staleTabs: waiting.filter((id) => id !== tabId) });

    if (!gone) {
        chrome.tabs.reload(tabId).catch(() => {});
    }
}
