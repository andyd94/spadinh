// Helpers shared by the Discogs and YouTube content scripts; listed first in each manifest entry.

const SPADINH_TOAST_ID = "spadinh-toast";
const SPADINH_TOAST_MS = 2500;

let spadinhToastTimer = null;

// Same rule as dinhscogvery's keymap: a key does nothing while the user is typing somewhere.
function spadinhIsTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tag = target.tagName.toLowerCase();

    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function spadinhShowToast(text) {
    let toast = document.getElementById(SPADINH_TOAST_ID);

    if (!toast) {
        toast = document.createElement("div");
        toast.id = SPADINH_TOAST_ID;
        toast.style.cssText = [
            "position: fixed",
            "right: 16px",
            "bottom: 16px",
            "z-index: 2147483647",
            "padding: 10px 14px",
            "border-radius: 8px",
            "background: #2d3748",
            "color: #e2e8f0",
            "font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4)",
            "transition: opacity 0.2s ease",
            "pointer-events: none"
        ].join("; ");
        document.body.appendChild(toast);
    }

    toast.textContent = text;
    toast.style.opacity = "1";

    clearTimeout(spadinhToastTimer);
    spadinhToastTimer = setTimeout(() => { toast.style.opacity = "0"; }, SPADINH_TOAST_MS);
}

// Upload-title noise that isn't part of the track name. Deliberately narrow: "(Original Mix)",
// "(Remix)", "(Dub)" and the like *are* the track name and must survive.
const SPADINH_TITLE_NOISE = /\s*[(\[](?:official(?:\s+(?:music|lyric))?(?:\s+(?:video|audio))?|lyrics?\s+video|visuali[sz]er|hd|hq|4k|1080p|720p)[)\]]/gi;

// Square-bracketed tags are labels ("[Megaphone Records]"), catalogue numbers, years and quality
// flags - never the track name - except the odd upload that brackets its mix name instead.
const SPADINH_BRACKET_TAG = /\s*\[[^\]]*\]/g;
const SPADINH_MIX_WORDS = /\b(?:mix|remix|dub|edit|re-?edit|version|instrumental|vocal|bootleg|rework|vip|refix|flip|cut|acapella|extended|radio|club|original)\b/i;

// Round brackets naming the label rather than a mix: "(Megaphone Records)", "(Hotflush Recordings)".
const SPADINH_LABEL_PARENS = /\s*\((?:[^()]*\s)?(?:records|recordings|recs?\.?|music|label)\)/gi;

// A catalogue number in round brackets - "(MEGA004)", "(DUMB_004)", "(spork 03)", "(TSR-003LP)" -
// or a year. Letters then two to five digits, so "(Part 2)" and "(Vol 1)" aren't caught; the
// named words are excluded outright in case of "(Vol 10)".
const SPADINH_CATALOGUE_PARENS = /\s*\((?!(?:part|pt|vol|volume|disc|disk|side|cd|take|no|track|ep|lp)\b)(?:[A-Za-z]{1,8}[-_ ]?\d{2,5}[A-Za-z]{0,2}|(?:19|20)\d{2})\)/gi;

// "artist - track" straight from the title when it already has that shape, which is the norm for
// record rips; otherwise `artist` (a channel name, or the Discogs release artist) stands in.
// Discogs writes its dashes as en dashes (–); they come out as plain hyphens so the query reads
// the way anyone would type it.
function spadinhSearchQuery(title, artist) {
    const cleaned = (title || "")
        .replace(SPADINH_TITLE_NOISE, " ")
        .replace(SPADINH_BRACKET_TAG, (tag) => (SPADINH_MIX_WORDS.test(tag) ? tag : " "))
        .replace(SPADINH_LABEL_PARENS, " ")
        .replace(SPADINH_CATALOGUE_PARENS, " ")
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return "";
    }

    if (/\s-\s/.test(cleaned) || !artist) {
        return cleaned;
    }

    return artist + " - " + cleaned;
}

// An artist name fit to put in front of a track, or "" when it names no one: Discogs credits
// compilations to "Various", YouTube's auto-generated channels to "Various Artists".
function spadinhArtistOrNone(name) {
    const trimmed = (name || "").trim();

    return /^various(\s+artists)?$/i.test(trimmed) ? "" : trimmed;
}

// Highlighted text as a search: whitespace collapsed (a selection can span table cells and
// lines), a leading Discogs track position like "A2 " dropped, and Discogs' "(2)" disambiguator
// taken off an artist name. Digits-only positions are left alone - "808 State" is an artist, not
// a position.
function spadinhSelectionTerms(text) {
    return (text || "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[A-Za-z]\d{1,2}\s+(?=\S)/, "")
        .replace(/ \(\d+\)(?= [-–—] |$)/g, "");
}

// Sends a request to the service worker. Progress and outcomes arrive separately as
// `spadinhToast` messages (shown by the top-level page script); only a refusal is shown from here.
function spadinhSend(message) {
    chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || !response) {
            spadinhShowToast("spadinh: no reply from the extension - try reloading it");
            return;
        }

        if (!response.ok) {
            spadinhShowToast(response.text);
        }
    });
}

function spadinhRequestYtLike(videoId) {
    spadinhSend({ action: "ytLike", videoId: videoId });
}

// Shift+S and nothing else held. With Shift down the key reports as "S", so the lowercase keymaps
// never see it; the handlers check this before they rule out Shift.
function spadinhIsSoulseekChord(event) {
    return event.key === "S" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

// Same "artist - track" query as `s`, searched in SoulseekQt instead of Google (see background.js).
function spadinhRequestSoulseekSearch(title, artist) {
    spadinhSend({ action: "slskSearch", title: title, artist: artist });
}
