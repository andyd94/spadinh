// YouTube watch pages: `s` searches Google for the playing video as "artist - track", `a` likes it.

const YT_KEYS = { s: ytSearchVideo, a: ytLikeVideo };

ytKeysInit();

function ytKeysInit() {
    // Capture phase, so this runs ahead of YouTube's own hotkey manager. Neither `s` nor `a` is a
    // YouTube shortcut today (`l` was, which is why like moved off it), and stopping the event
    // here keeps it that way if YouTube ever binds one of them.
    document.addEventListener("keydown", ytOnKeyDown, true);
}

function ytOnKeyDown(event) {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    const action = YT_KEYS[event.key];

    if (!action || window.location.pathname !== "/watch") {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    action();
}

// The on-page title, not `document.title`: YouTube is a single-page app and the tab title can lag
// a video change by a beat. `document.title` is the fallback, with its " - YouTube" trimmed.
function ytVideoTitle() {
    const element = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1");
    const text = element ? element.textContent.trim() : "";

    return text || document.title.replace(/\s*-\s*YouTube$/, "").trim();
}

function ytChannelName() {
    const element = document.querySelector("ytd-video-owner-renderer #channel-name a");

    return element ? element.textContent.trim() : "";
}

function ytSearchVideo() {
    const query = spadinhSearchQuery(ytVideoTitle(), ytChannelName());

    if (!query) {
        spadinhShowToast("couldn't read the video title");
        return;
    }

    window.open("https://www.google.com/search?q=" + encodeURIComponent(query), "_blank");
    spadinhShowToast("searching: " + query);
}

// `like-button-view-model` is the like half of the segmented like/dislike control; the aria-label
// fallback can't match the dislike button, whose label is capitalised "Dislike this video".
function ytLikeButton() {
    return document.querySelector('like-button-view-model button, button[aria-label^="like this video"]');
}

// Likes only — the button toggles, and `a` on an already-liked video shouldn't quietly unlike it.
function ytLikeVideo() {
    const button = ytLikeButton();

    if (!button) {
        spadinhShowToast("couldn't find the like button");
        return;
    }

    if (button.getAttribute("aria-pressed") === "true") {
        spadinhShowToast("already liked");
        return;
    }

    button.click();
    spadinhShowToast("liked");
}

// --- Likes asked for from Discogs ----------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytAutoLike") {
        return false;
    }

    ytAutoLike()
        .then((text) => sendResponse({ ok: true, text: text }))
        .catch((error) => sendResponse({ ok: false, text: error.message }));

    return true;
});

// This tab was opened in the background by the service worker for a like requested on Discogs.
// The watch page autoplays, which would play over whatever Discogs is playing, so the player is
// kept muted and paused for the few seconds the tab exists. The like is only reported once the
// button actually shows pressed — a click while signed out opens a sign-in prompt instead.
async function ytAutoLike() {
    const keepQuiet = setInterval(ytSilenceVideo, 250);

    ytSilenceVideo();

    try {
        if (!await ytWaitFor(ytLikeButton, 10 * 1000)) {
            throw new Error("couldn't find the like button on YouTube");
        }

        if (ytLikeButton().getAttribute("aria-pressed") === "true") {
            return "already liked on YouTube: " + ytVideoTitle();
        }

        ytLikeButton().click();

        const stuck = await ytWaitFor(() => {
            const button = ytLikeButton();
            return button && button.getAttribute("aria-pressed") === "true" ? button : null;
        }, 3 * 1000);

        if (!stuck) {
            throw new Error("like didn't register - signed in to YouTube in this browser?");
        }

        return "liked on YouTube: " + ytVideoTitle();
    } finally {
        clearInterval(keepQuiet);
    }
}

function ytSilenceVideo() {
    const video = document.querySelector("video");

    if (video) {
        video.muted = true;

        if (!video.paused) {
            video.pause();
        }
    }
}

// Polls `probe` until it returns something truthy, or `null` after `timeoutMs`. Background tabs
// throttle timers to about once a second, which is fine at these timeouts.
function ytWaitFor(probe, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();

        (function poll() {
            const result = probe();

            if (result) {
                resolve(result);
            } else if (Date.now() - started > timeoutMs) {
                resolve(null);
            } else {
                setTimeout(poll, 200);
            }
        })();
    });
}
