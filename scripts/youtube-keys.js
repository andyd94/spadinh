// YouTube: `s` searches Google for a video as "artist - track", `a` likes it, `d` adds it to the
// Downloads playlist, `Shift+D` hands it to Downloadinh to download. The video is the one
// under the mouse pointer - a row of the liked list, the playlist panel, the sidebar, a search
// result - and, on a watch page with the pointer on none, the one playing.

const YT_KEYS = { s: ytSearchVideo, a: ytLikeVideo, d: ytSaveVideo };
const YT_HOVER_KEYS = { s: ytSearchHovered, a: ytLikeHovered, d: ytSaveHovered };

// Everything YouTube lists a video in: playlist pages (the liked list among them), the playlist
// panel beside a playing video, the watch-page sidebar, search results, home and channel grids,
// and the newer "lockup" tiles that are replacing several of those.
const YT_ITEM_SELECTOR = [
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-reel-item-renderer",
    "ytd-video-preview",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "a.ytp-videowall-still",
    "a.ytp-ce-covering-overlay"
].join(", ");

const YT_ITEM_TITLE_SELECTOR = [
    "#video-title",
    ".yt-lockup-metadata-view-model__title",
    ".yt-lockup-metadata-view-model-wiz__title",
    ".ytp-videowall-still-info-title",
    ".ytp-ce-video-title",
    "h3 a",
    "h3",
    "a[title]"
].join(", ");

const YT_ITEM_CHANNEL_SELECTOR = [
    "ytd-channel-name #text",
    "#byline",
    ".yt-content-metadata-view-model__metadata-text",
    ".yt-content-metadata-view-model-wiz__metadata-text",
    "#channel-name"
].join(", ");

const YT_ITEM_DURATION_SELECTOR = [
    "ytd-thumbnail-overlay-time-status-renderer #text",
    ".yt-badge-shape__text",
    ".badge-shape-wiz__text",
    "badge-shape"
].join(", ");

const YT_TIMESTAMP = /^\d{1,2}(:\d{2}){1,2}$/;

const YT_VIDEO_LINK_SELECTOR = 'a[href*="watch?v="], a[href*="/shorts/"]';
// How far up from the pointer an unrecognised layout is searched for the video it sits in.
const YT_LOOSE_ITEM_DEPTH = 6;

ytKeysInit();

function ytKeysInit() {
    // Capture phase, so this runs ahead of YouTube's own hotkey manager. None of `s`, `a`, `d` or
    // `Shift+D` is a YouTube shortcut today (`l` was, which is why like moved off it), and
    // stopping the event here keeps it that way if YouTube ever binds one of them.
    document.addEventListener("keydown", ytOnKeyDown, true);

    // Progress of a download comes back from the service worker as toasts.
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "spadinhToast") {
            spadinhShowToast(message.text);
        }
    });
}

function ytOnKeyDown(event) {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }

    if (spadinhIsTypingTarget(event.target)) {
        return;
    }

    const download = spadinhIsDownloadChord(event);

    if (!download && (event.shiftKey || !YT_KEYS[event.key])) {
        return;
    }

    const hovered = ytHoveredVideo();

    if (!hovered && window.location.pathname !== "/watch") {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (hovered) {
        ytFlashItem(hovered.item);
        (download ? ytDownloadHovered : YT_HOVER_KEYS[event.key])(hovered);
    } else {
        (download ? ytDownloadVideo : YT_KEYS[event.key])();
    }
}

// --- The video under the pointer ---------------------------------------------------------------

// `{ videoId, title, channel, item }` for the listed video the pointer is on, or null: on none, on
// the player itself, or on the playing video's own entry (the playlist panel lists it too), which
// the playing-video actions handle better - they know whether it's liked already.
function ytHoveredVideo() {
    const chain = document.querySelectorAll(":hover");
    const pointed = chain.length ? chain[chain.length - 1] : null;

    if (!pointed) {
        return null;
    }

    // The player and the title, channel and description under it are the playing video's own;
    // a link in its description isn't a video the pointer is "on".
    const listed = pointed.closest(YT_ITEM_SELECTOR);
    const item = listed || (pointed.closest("#movie_player, ytd-watch-metadata") ? null : ytLooseItem(pointed));
    const videoId = item ? ytItemVideoId(item) : null;

    if (!videoId || (window.location.pathname === "/watch" && videoId === ytWatchVideoId())) {
        return null;
    }

    const title = listed ? ytItemTitle(item) : ytLooseTitle(item);
    const described = title ? item : (ytItemElsewhere(videoId, item) || item);
    const channel = listed || described !== item ? ytItemRawChannel(described) : "";

    return {
        videoId: videoId,
        title: title || (described !== item ? ytItemTitle(described) : ""),
        channel: spadinhArtistOrNone(channel.replace(/\s+-\s+Topic$/i, "")),
        rawChannel: channel,
        duration: ytItemDuration(described),
        item: item
    };
}

// A layout not in the list above: the nearest ancestor that links to exactly one video. Stops at
// the first ancestor linking to several - that's a list, and the pointer is between its rows.
function ytLooseItem(pointed) {
    let node = pointed;

    for (let depth = 0; node && node !== document.body && depth < YT_LOOSE_ITEM_DEPTH; depth++) {
        const ids = new Set(ytVideoLinks(node).map(ytVideoIdFromLink).filter(Boolean));

        if (ids.size === 1) {
            return node;
        }

        if (ids.size > 1) {
            return null;
        }

        node = node.parentElement;
    }

    return null;
}

function ytVideoLinks(node) {
    const links = Array.from(node.querySelectorAll(YT_VIDEO_LINK_SELECTOR));

    if (node.matches(YT_VIDEO_LINK_SELECTOR)) {
        links.unshift(node);
    }

    return links;
}

function ytVideoIdFromLink(link) {
    const match = (link.getAttribute("href") || "").match(/(?:[?&]v=|\/shorts\/)([A-Za-z0-9_-]{11})/);

    return match ? match[1] : null;
}

function ytItemVideoId(item) {
    for (const link of ytVideoLinks(item)) {
        const videoId = ytVideoIdFromLink(link);

        if (videoId) {
            return videoId;
        }
    }

    return null;
}

// The `title` attribute where there is one: the visible text of a long title is cut short by CSS
// but can also carry badges and screen-reader extras.
function ytItemTitle(item) {
    const element = item.querySelector(YT_ITEM_TITLE_SELECTOR);

    return element ? (element.getAttribute("title") || element.textContent || "").trim() : "";
}

// An unrecognised layout's title is read off the video link itself, never off the nearest
// heading: around a lone link that's the section's ("People mentioned", "Music"), not the video's.
function ytLooseTitle(item) {
    for (const link of ytVideoLinks(item)) {
        const text = (link.getAttribute("title") || link.getAttribute("aria-label") || link.textContent || "")
            .replace(/\s+/g, " ").trim();

        if (text && !YT_TIMESTAMP.test(text)) {
            return text;
        }
    }

    return "";
}

// The channel as YouTube prints it, " - Topic" and all: Downloadinh is told it's a channel and
// makes of that what it can.
function ytItemRawChannel(item) {
    const element = item.querySelector(YT_ITEM_CHANNEL_SELECTOR);
    const name = element ? (element.getAttribute("title") || element.textContent || "") : "";

    return name.replace(/\s+/g, " ").trim();
}

// The length off the thumbnail's badge, in seconds, or 0: "6:41", "1:02:03". Live and "Mix"
// badges aren't lengths.
function ytItemDuration(item) {
    for (const badge of item.querySelectorAll(YT_ITEM_DURATION_SELECTOR)) {
        const text = badge.textContent.trim();

        if (YT_TIMESTAMP.test(text)) {
            return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
        }
    }

    return 0;
}

// The hover preview that plays over a thumbnail carries the video's link but not its title; the
// tile it grew out of is still on the page and has both.
function ytItemElsewhere(videoId, except) {
    for (const item of document.querySelectorAll(YT_ITEM_SELECTOR)) {
        if (item !== except && ytItemVideoId(item) === videoId && ytItemTitle(item)) {
            return item;
        }
    }

    return null;
}

// Shows which video a key landed on; the toast names it too.
function ytFlashItem(item) {
    if (typeof item.animate !== "function") {
        return;
    }

    item.animate(
        [
            { outline: "2px solid #63b3ed", outlineOffset: "-2px" },
            { outline: "2px solid rgba(99, 179, 237, 0)", outlineOffset: "-2px" }
        ],
        { duration: 900, easing: "ease-out" }
    );
}

// What's known about a listed video, for the service worker to make a search or a download of.
// `playing: true` so it goes by this title and not by highlighted text. `artist` is Spadinh's
// own stand-in for when Downloadinh's cleaner can't be asked.
function ytHoveredContext(hovered) {
    return {
        title: hovered.title,
        artist: hovered.channel,
        channel: hovered.rawChannel,
        url: "https://www.youtube.com/watch?v=" + hovered.videoId,
        duration: hovered.duration,
        playing: true
    };
}

function ytSearchHovered(hovered) {
    if (!hovered.title) {
        spadinhShowToast("couldn't read that video's title");
        return;
    }

    spadinhSend(Object.assign({ action: "ytSearch" }, ytHoveredContext(hovered)));
}

function ytDownloadHovered(hovered) {
    if (!hovered.title) {
        spadinhShowToast("couldn't read that video's title");
        return;
    }

    spadinhSend(Object.assign({ action: "downloadTrack" }, ytHoveredContext(hovered)));
}

// Unlike the like button, the request doesn't say whether the video was liked already; liking
// twice is harmless.
function ytLikeHovered(hovered) {
    const what = hovered.title ? ": " + hovered.title : "";

    ytLikeViaInnertube(hovered.videoId)
        .then(() => spadinhShowToast("liked" + what))
        .catch((error) => spadinhShowToast("couldn't like" + what + " - " + error.message));
}

function ytSaveHovered(hovered) {
    ytSaveById(hovered.videoId, hovered.title);
}

// --- The playing video -------------------------------------------------------------------------

// The on-page title, not `document.title`: YouTube is a single-page app and the tab title can lag
// a video change by a beat. `document.title` is the fallback, with its " - YouTube" trimmed.
function ytVideoTitle() {
    const element = document.querySelector("ytd-watch-metadata #title h1") ||
        document.querySelector("h1.ytd-watch-metadata");
    const text = element ? element.textContent.trim() : "";

    return text || document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "").trim();
}

function ytRawChannelName() {
    const element = document.querySelector("ytd-video-owner-renderer #channel-name a");

    return element ? element.textContent.replace(/\s+/g, " ").trim() : "";
}

// The description as far as the page shows it: all of it once expanded, the first lines before.
// Not the cards under it ("People mentioned", "Music"), which aren't the uploader's words.
function ytDescription() {
    for (const selector of YT_DESCRIPTION_SELECTORS) {
        const element = document.querySelector(selector);
        const text = element ? (element.innerText || element.textContent || "").trim() : "";

        if (text) {
            return text.slice(0, 5000);
        }
    }

    return "";
}

const YT_DESCRIPTION_SELECTORS = [
    "ytd-watch-metadata #description-inline-expander[is-expanded] yt-attributed-string",
    "ytd-watch-metadata #attributed-snippet-text",
    "ytd-watch-metadata #description-inline-expander yt-attributed-string"
];

function ytVideoContext() {
    const video = document.querySelector("video");
    const videoId = ytWatchVideoId();

    return {
        title: ytVideoTitle(),
        artist: ytChannelName(),
        channel: ytRawChannelName(),
        description: ytDescription(),
        url: videoId ? "https://www.youtube.com/watch?v=" + videoId : "",
        duration: video && isFinite(video.duration) ? Math.round(video.duration) : 0,
        playing: ytIsPlaying()
    };
}

// YouTube's auto-generated artist channels are named "Artist - Topic"; the artist is what's
// wanted in front of the track. "Various Artists - Topic" names no one, so it stands in for nothing.
function ytChannelName() {
    const element = document.querySelector("ytd-video-owner-renderer #channel-name a");

    return spadinhArtistOrNone(element ? element.textContent.replace(/\s+-\s+Topic\s*$/i, "") : "");
}

function ytIsPlaying() {
    const video = document.querySelector("video");

    return !!video && !video.paused && !video.ended;
}

// Both go through the service worker, which settles what's meant (the playing video, else
// highlighted text, else the paused video) and asks Downloadinh's cleaner what to call it.
function ytSearchVideo() {
    spadinhSend(Object.assign({ action: "ytSearch" }, ytVideoContext()));
}

function ytDownloadVideo() {
    spadinhSend(Object.assign({ action: "downloadTrack" }, ytVideoContext()));
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

function ytWatchVideoId() {
    return new URLSearchParams(window.location.search).get("v");
}

// Straight from this page: it's youtube.com with the user's cookies, so no service worker needed.
function ytSaveVideo() {
    const videoId = ytWatchVideoId();

    if (!videoId) {
        spadinhShowToast("couldn't tell which video this is");
        return;
    }

    ytSaveById(videoId, ytVideoTitle());
}

function ytSaveById(videoId, title) {
    spadinhShowToast("adding to " + YT_DOWNLOADS_PLAYLIST + "…");

    ytSaveToDownloads(videoId)
        .then((result) => spadinhShowToast(ytSaveResultText(result, title)))
        .catch((error) => spadinhShowToast("couldn't add to " + YT_DOWNLOADS_PLAYLIST + ": " + error.message));
}

// --- Saves asked for from Discogs, when the player frame couldn't ------------------------------
//
// Same background tab as the likes below, kept muted and paused while it exists.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== "ytAutoSave") {
        return false;
    }

    const keepQuiet = setInterval(ytSilenceVideo, 250);

    ytSilenceVideo();

    ytSaveToDownloads(ytWatchVideoId())
        .then((result) => sendResponse({ ok: true, text: ytSaveResultText(result, ytVideoTitle()) }))
        .catch((error) => sendResponse({ ok: false, text: "couldn't add to " + YT_DOWNLOADS_PLAYLIST + ": " + error.message }))
        .finally(() => clearInterval(keepQuiet));

    return true;
});

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
