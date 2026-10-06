// Inside a YouTube embed (Discogs' player, for one): `a` likes the embedded video on YouTube. Once
// the player has been clicked, keystrokes go to this iframe rather than the page around it, so
// the page's own `a` handler never sees them — this one does, and the id is right in the URL.
//
// This frame is also where the like itself happens when it can: it's a youtube.com origin with the
// user's cookies, so it can send the same internal request the like button does. The service
// worker asks it to (`ytLikeInFrame`) before falling back to opening a watch page.

const YT_EMBED_KEYS = { a: ytEmbedLike, s: ytEmbedSearch };

const YT_INNERTUBE_ORIGIN = "https://www.youtube.com";
// What youtube.com's own client identifies as; the version only has to look plausible.
const YT_INNERTUBE_CLIENT_VERSION = "2.20240101.00.00";

document.addEventListener("keydown", ytEmbedOnKeyDown);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // The page around this frame can't see which video is loaded — Discogs switches videos through
    // the IFrame API, which leaves the iframe's `src` on whatever loaded first — so the service
    // worker asks here first, and this frame's answer wins over the page's guess.
    if (message.action === "ytCurrentVideoId") {
        sendResponse({ videoId: ytEmbedVideoId(), title: ytEmbedVideoTitle() });
        return false;
    }

    if (message.action === "ytLikeInFrame") {
        ytLikeViaInnertube(message.videoId)
            .then(() => sendResponse({ ok: true, title: ytEmbedVideoTitle() }))
            .catch((error) => sendResponse({ ok: false, text: error.message }));

        return true;
    }

    return false;
});

// The "Watch on YouTube" link tracks the video actually loaded; the URL only knows the first one.
// The title-bar link comes first, then the one on the "watch on YouTube" interstitial; end-screen
// "more videos" tiles also link to watch pages but to *other* videos, so they're excluded.
function ytEmbedVideoId() {
    const link = document.querySelector(
        'a.ytp-title-link[href*="v="], .ytp-chrome-top a[href*="watch?v="], ' +
        'yt-player-interstitial-renderer a[href*="watch?v="], ' +
        'a[href*="youtube.com/watch?v="]:not(.ytp-videowall-still):not(.ytp-ce-covering-overlay)'
    );
    const linkMatch = link ? link.href.match(/[?&]v=([A-Za-z0-9_-]{11})/) : null;

    if (linkMatch) {
        return linkMatch[1];
    }

    const pathMatch = window.location.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);

    return pathMatch ? pathMatch[1] : null;
}

function ytEmbedVideoTitle() {
    const link = document.querySelector("a.ytp-title-link");
    const text = link ? link.textContent.trim() : "";

    return text || (document.title !== "YouTube" ? document.title : "");
}

function ytEmbedOnKeyDown(event) {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    const action = YT_EMBED_KEYS[event.key];

    if (action) {
        action();
    }
}

// Goes through the service worker rather than liking here directly, so the toasts land on the
// page around the player and the watch-page fallback applies when this frame can't.
function ytEmbedLike() {
    const videoId = ytEmbedVideoId();

    if (videoId !== null) {
        spadinhRequestYtLike(videoId);
    }
}

// The service worker opens the search tab: no popup-blocker question from inside an iframe, and
// the "searching: …" toast lands on the page around the player.
function ytEmbedSearch() {
    spadinhSend({ action: "ytSearch", title: ytEmbedVideoTitle(), artist: "" });
}

// --- The like button's own request, replayed ---------------------------------------------------
//
// youtube.com authorises its internal API with `SAPISIDHASH <seconds>_<sha1("<seconds> <SAPISID>
// <origin>")>`, derived from the SAPISID cookie, plus the session cookies themselves. This is
// undocumented and can stop working whenever YouTube changes it — any failure is reported to the
// service worker, which then takes the watch-page route instead.

async function ytLikeViaInnertube(videoId) {
    const sapisid = ytCookie("SAPISID") || ytCookie("__Secure-3PAPISID");

    if (!sapisid) {
        throw new Error("not signed in to YouTube in the player");
    }

    const seconds = Math.floor(Date.now() / 1000);
    const hash = await ytSha1Hex(seconds + " " + sapisid + " " + YT_INNERTUBE_ORIGIN);
    const apiKey = ytPageConfig("INNERTUBE_API_KEY");
    const url = YT_INNERTUBE_ORIGIN + "/youtubei/v1/like/like" +
        (apiKey ? "?key=" + encodeURIComponent(apiKey) : "");

    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
            "Authorization": "SAPISIDHASH " + seconds + "_" + hash,
            "X-Origin": YT_INNERTUBE_ORIGIN,
            // Which signed-in Google account, when there's more than one in the session.
            "X-Goog-AuthUser": ytPageConfig("SESSION_INDEX") || "0",
            "X-Youtube-Client-Name": "1",
            "X-Youtube-Client-Version": YT_INNERTUBE_CLIENT_VERSION,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: YT_INNERTUBE_CLIENT_VERSION } },
            target: { videoId: videoId }
        })
    });

    if (!response.ok) {
        throw new Error("YouTube refused the like (HTTP " + response.status + ")");
    }

    const payload = await response.json();

    if (payload && payload.error) {
        throw new Error("YouTube refused the like: " + (payload.error.message || payload.error.status));
    }
}

function ytCookie(name) {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));

    return match ? decodeURIComponent(match[1]) : null;
}

// `ytcfg` lives in the page's own world, out of a content script's reach, but its values sit in
// the inline script that sets it.
function ytPageConfig(name) {
    for (const script of document.querySelectorAll("script")) {
        const match = script.textContent.match(new RegExp('"' + name + '":"?([^",}]+)"?'));

        if (match) {
            return match[1];
        }
    }

    return null;
}

async function ytSha1Hex(text) {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));

    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
