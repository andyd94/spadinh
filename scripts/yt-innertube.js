// youtube.com's internal API ("innertube"), called the way its own buttons call it. Loaded on
// watch pages and in embed frames — both youtube.com origins carrying the user's cookies — so the
// like (`a`) and the save to the Downloads playlist (`d`) go out as the signed-in user, with no
// Google Cloud project or OAuth sign-in involved.
//
// youtube.com authorises these requests with `SAPISIDHASH <seconds>_<sha1("<seconds> <SAPISID>
// <origin>")>`, derived from the SAPISID cookie, plus the session cookies themselves. This is
// undocumented and can stop working whenever YouTube changes it: every failure throws, and the
// callers report it or fall back to a watch page.

const YT_INNERTUBE_ORIGIN = "https://www.youtube.com";
// What youtube.com's own client identifies as; the version only has to look plausible.
const YT_INNERTUBE_CLIENT_VERSION = "2.20240101.00.00";

async function ytInnertube(endpoint, body) {
    const sapisid = ytCookie("SAPISID") || ytCookie("__Secure-3PAPISID");

    if (!sapisid) {
        throw new Error("not signed in to YouTube here");
    }

    const seconds = Math.floor(Date.now() / 1000);
    const hash = await ytSha1Hex(seconds + " " + sapisid + " " + YT_INNERTUBE_ORIGIN);
    const apiKey = ytPageConfig("INNERTUBE_API_KEY");
    const url = YT_INNERTUBE_ORIGIN + "/youtubei/v1/" + endpoint +
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
        body: JSON.stringify(Object.assign({
            context: { client: { clientName: "WEB", clientVersion: YT_INNERTUBE_CLIENT_VERSION } }
        }, body))
    });

    if (!response.ok) {
        throw new Error("YouTube refused it (HTTP " + response.status + ")");
    }

    const payload = await response.json();

    if (payload && payload.error) {
        throw new Error("YouTube refused it: " + (payload.error.message || payload.error.status));
    }

    return payload;
}

async function ytLikeViaInnertube(videoId) {
    await ytInnertube("like/like", { target: { videoId: videoId } });
}

// Adds the video to the Downloads playlist, creating the playlist (private) if there isn't one.
// Resolves to what happened, for the toast (`ytSaveResultText` in _shared.js): "added",
// "already" or "created".
//
// The "Save to playlist" dialog's own data says which playlists exist and whether this video is
// already in each. Its shape has changed over the years (renderers, then view models), so rather
// than one fixed path it's searched for anything titled "Downloads" that carries a playlist id.
async function ytSaveToDownloads(videoId) {
    const dialog = await ytInnertube("playlist/get_add_to_playlist", { videoIds: [videoId] });
    const existing = ytFindNamedPlaylist(dialog, YT_DOWNLOADS_PLAYLIST);

    if (!existing) {
        const created = await ytInnertube("playlist/create", {
            title: YT_DOWNLOADS_PLAYLIST,
            privacyStatus: "PRIVATE",
            videoIds: [videoId]
        });

        if (!created || !created.playlistId) {
            throw new Error("YouTube didn't create the Downloads playlist");
        }

        return "created";
    }

    if (existing.contains) {
        return "already";
    }

    const edited = await ytInnertube("browse/edit_playlist", {
        playlistId: existing.playlistId,
        actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId: videoId }]
    });

    if (edited && edited.status && edited.status !== "STATUS_SUCCEEDED") {
        throw new Error("YouTube didn't add it (" + edited.status + ")");
    }

    return "added";
}

// The first object titled `name` that has a playlist id on it or anywhere beneath it.
function ytFindNamedPlaylist(node, name) {
    if (!node || typeof node !== "object") {
        return null;
    }

    if (!Array.isArray(node) && ytTextOf(node.title).toLowerCase() === name.toLowerCase()) {
        const playlistId = ytFindKey(node, "playlistId");

        if (playlistId) {
            return { playlistId: playlistId, contains: node.containsSelectedVideos === "ALL" };
        }
    }

    for (const value of Object.values(node)) {
        const found = ytFindNamedPlaylist(value, name);

        if (found) {
            return found;
        }
    }

    return null;
}

function ytFindKey(node, key) {
    if (!node || typeof node !== "object") {
        return null;
    }

    if (typeof node[key] === "string" && node[key]) {
        return node[key];
    }

    for (const value of Object.values(node)) {
        const found = ytFindKey(value, key);

        if (found) {
            return found;
        }
    }

    return null;
}

// Innertube writes text as a plain string, `{ simpleText }`, `{ runs: [{ text }] }` or `{ content }`.
function ytTextOf(text) {
    if (!text) {
        return "";
    }

    if (typeof text === "string") {
        return text.trim();
    }

    if (typeof text.simpleText === "string") {
        return text.simpleText.trim();
    }

    if (typeof text.content === "string") {
        return text.content.trim();
    }

    if (Array.isArray(text.runs)) {
        return text.runs.map((run) => run.text || "").join("").trim();
    }

    return "";
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
