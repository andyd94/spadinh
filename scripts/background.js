// The query builder shared with the content scripts; nothing else in there runs at load.
importScripts("_shared.js");

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
        throw new DcvError(response.status, await readDcvDetail(response, baseUrl));
    }

    return { status: response.status, data: response.status === 204 ? null : await response.json() };
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
    const baseUrl = await getDcvBaseUrl();
    let response;

    try {
        response = await fetch(baseUrl + "/api/export?" + query);
    } catch (error) {
        throw new DcvError(0, "can't reach dinhscogvery at " + baseUrl + " - is it running?");
    }

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
        started: !!video && video.currentTime > 0
    };
}

// --- Searching SoulseekQt --------------------------------------------------------------------------
//
// Shift+A on a Discogs page, in its player, or on a YouTube watch page: the same "artist - track"
// query as `s`, typed into SoulseekQt's search box. SoulseekQt has no API, so Chrome hands the
// query to the native host in native/ (registered by native/install.sh), which drives the app's
// search field through macOS accessibility and reports back.

const SLSK_HOST = "com.spadinh.soulseek";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "slskSearch") {
        return false;
    }

    const originTabId = sender.tab ? sender.tab.id : null;

    resolveSearchQuery(originTabId, message, senderOnDiscogs(sender))
        .then((query) => {
            if (!query) {
                notifyPage(originTabId, "nothing playing and nothing highlighted");
                return;
            }

            notifyPage(originTabId, "soulseek: " + query + "…");

            return searchInSoulseek(query).then((text) => notifyPage(originTabId, text));
        })
        .catch((error) => notifyPage(originTabId, error.message));

    sendResponse({ ok: true });
    return false;
});

// `lastError` here nearly always means the host isn't registered for this extension id, or the
// registration points at a path that's moved — both fixed by re-running native/install.sh.
function searchInSoulseek(query) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(SLSK_HOST, { query: query }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error("can't reach the Soulseek bridge (" + chrome.runtime.lastError.message +
                    ") - run native/install.sh"));
                return;
            }

            if (!response || !response.ok) {
                reject(new Error(response && response.text ? response.text : "no reply from the Soulseek bridge"));
                return;
            }

            resolve(response.text);
        });
    });
}

async function resolveCurrentVideoId(tabId, pageGuess) {
    const embed = await askEmbedFrame(tabId);

    return embed ? embed.videoId : pageGuess;
}

// `s` on a Discogs page or in its player: a Google search for the loaded video as "artist - track",
// opened from here so an iframe never has to open a popup itself.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytSearch") {
        return false;
    }

    const originTabId = sender.tab ? sender.tab.id : null;

    resolveSearchQuery(originTabId, message, senderOnDiscogs(sender))
        .then((query) => {
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

// What `s` and Shift+A search for. A playing video wins; otherwise text highlighted on the page,
// so a tracklist line can be searched without playing it; otherwise whatever video is loaded
// (paused counts), or the page's guess. `message.playing` covers pages the player probe can't
// see into: YouTube watch pages, and the embed frame answering for itself.
//
// A highlight that carries no " - " of its own gets an artist in front, like a video title would:
// the one the sender gave (the channel on YouTube, the release artist on Discogs), or, when the
// key was pressed inside the player and the embed frame knows no artist, the Discogs page's own
// heading. Single-artist releases list bare track names, which is exactly this case.
async function resolveSearchQuery(tabId, message, onDiscogs) {
    const embed = await askEmbedFrame(tabId);
    const playing = (embed && embed.playing) || message.playing === true;

    if (!playing) {
        const page = await readPageContext(tabId);
        const selection = spadinhSelectionTerms(page.selection);

        if (selection) {
            return spadinhSearchQuery(selection, message.artist || (onDiscogs ? page.artist : ""));
        }
    }

    const title = (embed && embed.title) || message.title || "";

    return spadinhSearchQuery(title, message.artist || "");
}

function senderOnDiscogs(sender) {
    try {
        return /(^|\.)discogs\.com$/.test(new URL(sender.tab.url).hostname);
    } catch (error) {
        return false;
    }
}

// The top frame's selection and release artist, whichever frame the key was pressed in - with
// the player focused, the highlight is still on the page around it. Mirrors
// discogs-video-keys.js's artist reading, which can't be called from here.
async function readPageContext(tabId) {
    const empty = { selection: "", artist: "" };

    if (tabId === null) {
        return empty;
    }

    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                const heading = document.querySelector("h1");
                const match = heading ? heading.textContent.trim().match(/^(.+?)\s[–—-]\s/) : null;

                return {
                    selection: String(window.getSelection ? window.getSelection() : ""),
                    artist: match ? match[1].trim() : ""
                };
            }
        });
        const page = result && result.result ? result.result : empty;

        return { selection: page.selection || "", artist: spadinhArtistOrNone(page.artist) };
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
    const tab = await chrome.tabs.create({ url: "https://www.youtube.com/watch?v=" + videoId, active: false });

    try {
        await waitForTabLoad(tab.id);

        const response = await sendToTabWithRetry(tab.id, { action: "ytAutoLike" });

        if (!response || !response.ok) {
            throw new Error(response ? response.text : "no reply from the YouTube tab");
        }

        return response.text;
    } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
    }
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
