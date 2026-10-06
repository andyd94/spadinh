// Discogs release/master pages: `a` likes the video playing in the embedded player — on YouTube
// itself, since the embed has no like button. The service worker opens the watch page in a
// background tab, likes it there and closes it; progress and the result come back as toasts.

const DISCOGS_VIDEO_KEYS = { a: discogsLikePlayingVideo };

discogsVideoKeysInit();

function discogsVideoKeysInit() {
    document.addEventListener("keydown", discogsVideoOnKeyDown);

    // Sent by the service worker to every frame of this tab; this top-level script is the one
    // that shows it, so the toast lands on the page rather than inside the player iframe.
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "ytLikeResult") {
            spadinhShowToast(message.text);
        }
    });
}

// This page's best guess, which the service worker only uses when the embed frame can't answer
// (see youtube-embed-keys.js). While a video plays, Discogs flags its list entry with an
// `active_…` class (the suffix is a build hash, hence the prefix match) and that's definitive.
// Otherwise the mounted iframe or, before one exists, the player-slot thumbnail say what was
// *loaded* — right until a video is switched through the IFrame API, which updates neither.
function discogsPlayingVideoId() {
    const thumbnail = document.querySelector(
        'button[class*="active_"] img[src*="i.ytimg.com/vi/"], li[class*="player_"] img[src*="i.ytimg.com/vi/"]'
    );
    const thumbnailMatch = thumbnail ? thumbnail.src.match(/\/vi\/([A-Za-z0-9_-]{11})\//) : null;

    if (thumbnailMatch) {
        return thumbnailMatch[1];
    }

    const iframe = document.querySelector('iframe[src*="/embed/"]');
    const iframeMatch = iframe ? iframe.src.match(/\/embed\/([A-Za-z0-9_-]{11})/) : null;

    return iframeMatch ? iframeMatch[1] : null;
}

function discogsVideoOnKeyDown(event) {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    const action = DISCOGS_VIDEO_KEYS[event.key];

    if (action) {
        action();
    }
}

// Sent even when this page can't tell: the service worker asks the embed frame first, and it's the
// one that says "no video" if nothing answers.
function discogsLikePlayingVideo() {
    spadinhRequestYtLike(discogsPlayingVideoId());
}
