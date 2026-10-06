// YouTube watch pages: `s` searches Google for the playing video as "artist - track", `l` likes it.

const YT_KEYS = { s: ytSearchVideo, l: ytLikeVideo };

// Upload-title noise that isn't part of the track name. Deliberately narrow: "(Original Mix)",
// "(Remix)", "(Dub)" and the like *are* the track name and must survive.
const YT_TITLE_NOISE = /\s*[(\[](?:official(?:\s+(?:music|lyric))?(?:\s+(?:video|audio))?|lyrics?\s+video|visuali[sz]er|hd|hq|4k|1080p|720p)[)\]]/gi;

ytKeysInit();

function ytKeysInit() {
    // Capture phase, so this runs ahead of YouTube's own hotkey manager — which already binds
    // `l` to "seek forward 10s" and would fire alongside ours otherwise.
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

// "artist - track" straight from the title when it already has that shape, which is the norm for
// record rips; otherwise the channel stands in for the artist.
function ytSearchQuery(title, channel) {
    const cleaned = title.replace(YT_TITLE_NOISE, " ").replace(/\s+/g, " ").trim();

    if (!cleaned) {
        return "";
    }

    if (/\s[-–—]\s/.test(cleaned) || !channel) {
        return cleaned;
    }

    return channel + " - " + cleaned;
}

function ytSearchVideo() {
    const query = ytSearchQuery(ytVideoTitle(), ytChannelName());

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

// Likes only — the button toggles, and `l` on an already-liked video shouldn't quietly unlike it.
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
