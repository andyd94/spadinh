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

// Asks the service worker to like `videoId` on YouTube (see background.js). Progress and the
// outcome arrive separately as `ytLikeResult` messages; only a refusal is shown from here.
function spadinhRequestYtLike(videoId) {
    chrome.runtime.sendMessage({ action: "ytLike", videoId: videoId }, (response) => {
        if (chrome.runtime.lastError || !response) {
            spadinhShowToast("spadinh: no reply from the extension - try reloading it");
            return;
        }

        if (!response.ok) {
            spadinhShowToast(response.text);
        }
    });
}
