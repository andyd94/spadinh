// Inside a YouTube embed (Discogs' player, for one): `a` likes the embedded video on YouTube, `d`
// adds it to the Downloads playlist there. Once
// the player has been clicked, keystrokes go to this iframe rather than the page around it, so
// the page's own `a` handler never sees them — this one does, and the id is right in the URL.
//
// This frame is also where the like and the save themselves happen when they can: it's a
// youtube.com origin with the user's cookies, so it can send the same internal requests YouTube's
// own buttons do (yt-innertube.js). The service worker asks it to (`ytLikeInFrame`,
// `ytSaveInFrame`) before falling back to opening a watch page.

const YT_EMBED_KEYS = { a: ytEmbedLike, d: ytEmbedSave, s: ytEmbedSearch };

document.addEventListener("keydown", ytEmbedOnKeyDown);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // The page around this frame can't see which video is loaded — Discogs switches videos through
    // the IFrame API, which leaves the iframe's `src` on whatever loaded first — so the service
    // worker asks here first, and this frame's answer wins over the page's guess.
    if (message.action === "ytCurrentVideoId") {
        sendResponse({ videoId: ytEmbedVideoId(), title: ytEmbedVideoTitle(), duration: ytEmbedDuration() });
        return false;
    }

    if (message.action === "ytLikeInFrame") {
        ytLikeViaInnertube(message.videoId)
            .then(() => sendResponse({ ok: true, title: ytEmbedVideoTitle() }))
            .catch((error) => sendResponse({ ok: false, text: error.message }));

        return true;
    }

    if (message.action === "ytSaveInFrame") {
        ytSaveToDownloads(message.videoId)
            .then((result) => sendResponse({ ok: true, result: result, title: ytEmbedVideoTitle() }))
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

function ytEmbedDuration() {
    const video = document.querySelector("video");

    return video && isFinite(video.duration) ? Math.round(video.duration) : 0;
}

function ytEmbedVideoTitle() {
    const link = document.querySelector("a.ytp-title-link");
    const text = link ? link.textContent.trim() : "";

    return text || (document.title !== "YouTube" ? document.title : "");
}

function ytEmbedOnKeyDown(event) {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    if (spadinhIsDownloadChord(event)) {
        ytEmbedDownload();
        return;
    }

    if (event.shiftKey) {
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

function ytEmbedSave() {
    const videoId = ytEmbedVideoId();

    if (videoId !== null) {
        spadinhRequestYtSave(videoId);
    }
}

// Whether this frame's video is actually playing: when it isn't, the service worker prefers text
// highlighted on the page around the player.
function ytEmbedIsPlaying() {
    const video = document.querySelector("video");

    return !!video && !video.paused && !video.ended;
}

// The service worker opens the search tab: no popup-blocker question from inside an iframe, and
// the "searching: …" toast lands on the page around the player.
function ytEmbedSearch() {
    spadinhSend({ action: "ytSearch", title: ytEmbedVideoTitle(), artist: "", playing: ytEmbedIsPlaying() });
}

// Shift+D: the same video, to Downloadinh's queue. The service worker asks this frame for the title anyway.
function ytEmbedDownload() {
    spadinhSend({ action: "downloadTrack", title: ytEmbedVideoTitle(), artist: "", playing: ytEmbedIsPlaying() });
}
