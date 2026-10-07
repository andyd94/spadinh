// Discogs release/master pages: `a` likes the video playing in the embedded player on YouTube, `s`
// searches Google for it as "artist - track", `Shift+A` searches SoulseekQt for the same. All go
// through the service worker, which asks the player frame what's actually loaded; progress and
// results come back here as toasts.

const DISCOGS_VIDEO_KEYS = { a: discogsLikePlayingVideo, s: discogsSearchPlayingVideo };

discogsVideoKeysInit();

function discogsVideoKeysInit() {
    document.addEventListener("keydown", discogsVideoOnKeyDown);

    // Sent by the service worker to every frame of this tab; this top-level script is the one
    // that shows it, so the toast lands on the page rather than inside the player iframe.
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "spadinhToast") {
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
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    if (spadinhIsSoulseekChord(event)) {
        discogsSoulseekPlayingVideo();
        return;
    }

    if (event.shiftKey) {
        return;
    }

    const action = DISCOGS_VIDEO_KEYS[event.key];

    if (action) {
        action();
    }
}

// Same caveats as the id: the playing entry's title while it plays, else the mounted iframe's
// `title` attribute, which names the first video loaded, not the current one.
function discogsPlayingVideoTitle() {
    const active = document.querySelector('button[class*="active_"] div[class*="title_"]');

    if (active && active.textContent.trim()) {
        return active.textContent.trim();
    }

    const iframe = document.querySelector('iframe[src*="/embed/"]');

    return iframe && iframe.title ? iframe.title.trim() : "";
}

// The release heading is "Artist – Title"; its artist half stands in for a channel name when a
// video title doesn't carry its own.
function discogsReleaseArtist() {
    const heading = document.querySelector("h1");
    const match = heading ? heading.textContent.trim().match(/^(.+?)\s[–—-]\s/) : null;

    return match ? match[1].trim() : "";
}

// Sent even when this page can't tell: the service worker asks the embed frame first, and it's the
// one that says "no video" if nothing answers.
function discogsLikePlayingVideo() {
    spadinhRequestYtLike(discogsPlayingVideoId());
}

function discogsSearchPlayingVideo() {
    spadinhSend({ action: "ytSearch", title: discogsPlayingVideoTitle(), artist: discogsReleaseArtist() });
}

function discogsSoulseekPlayingVideo() {
    spadinhRequestSoulseekSearch(discogsPlayingVideoTitle(), discogsReleaseArtist());
}
