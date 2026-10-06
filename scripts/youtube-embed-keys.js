// Inside a YouTube embed (Discogs' player, for one): `a` likes the embedded video on YouTube. Once
// the player has been clicked, keystrokes go to this iframe rather than the page around it, so
// the page's own `a` handler never sees them — this one does, and the id is right in the URL.

const YT_EMBED_KEYS = { a: ytEmbedLike };

document.addEventListener("keydown", ytEmbedOnKeyDown);

// The page around this frame can't see which video is loaded — Discogs switches videos through
// the IFrame API, which leaves the iframe's `src` on whatever loaded first — so the service worker
// asks here before liking (`ytCurrentVideoId`), and this frame's answer wins over the page's guess.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytCurrentVideoId") {
        return false;
    }

    sendResponse({ videoId: ytEmbedVideoId() });
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

function ytEmbedLike() {
    const videoId = ytEmbedVideoId();

    if (videoId !== null) {
        spadinhRequestYtLike(videoId);
    }
}
