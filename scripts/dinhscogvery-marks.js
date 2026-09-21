// Seller-page marking: listings already passed in dinhscogvery are removed, listings on the
// Revisit list are highlighted. The id sets come from the service worker, which caches them.
//
// Runs independently of the ratio filter's `auto` setting — both remove listings, and the order
// they run in doesn't matter.

const DCV_MARK_CLASS = "spadinh-dcv-revisit";
const DCV_PASSED_ATTR = "data-spadinh-dcv-passed";

dcvMarksInit();

async function dcvMarksInit() {
    if (!onSellerPage()) {
        return;
    }

    dcvInjectMarkStyle();
    dcvMarksPaginationListener();
    dcvRemarkListener();

    await dcvApplyMarks();
}

// The popup's "re-sync" asks the open seller page to mark itself again off freshly fetched sets.
function dcvRemarkListener() {
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "dcvRemark") {
            dcvApplyMarks(true);
        }
    });
}

function dcvInjectMarkStyle() {
    const style = document.createElement("style");

    // The tint goes on the row, but the left bar goes on its first cell: a box-shadow on a `tr`
    // isn't painted under `border-collapse: collapse`, which the marketplace table uses. A
    // translucent tint so it reads on Discogs' light and dark themes alike.
    style.textContent = "." + DCV_MARK_CLASS + " {" +
        "background-color: rgba(79, 209, 197, 0.12) !important;" +
        "}" +
        "." + DCV_MARK_CLASS + " > td:first-child," +
        "." + DCV_MARK_CLASS + " > th:first-child {" +
        "box-shadow: inset 4px 0 0 #319795;" +
        "}";

    document.head.appendChild(style);
}

// The same pjax container the ratio filter watches: Discogs swaps the results in place on
// paging, so the new listings need marking too.
function dcvMarksPaginationListener() {
    const targetElement = document.getElementById("pjax_container");

    if (!targetElement) {
        return;
    }

    const observer = new MutationObserver(() => {
        if (!targetElement.classList.contains("loading")) {
            dcvApplyMarks();
        }
    });

    observer.observe(targetElement, { attributes: true, attributeFilter: ["class"] });
}

function dcvReleaseIdFromListing(element) {
    const link = element.querySelector(".item_release_link");
    const match = link ? link.href.match(/\/release\/(\d+)/) : null;

    return match ? parseInt(match[1], 10) : null;
}

function dcvRequestSets(force = false) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "dcvSets", force: force }, (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
                resolve(null);
                return;
            }

            resolve({ passed: new Set(response.passed), revisit: new Set(response.revisit) });
        });
    });
}

async function dcvApplyMarks(force = false) {
    const sets = await dcvRequestSets(force);

    // dinhscogvery unreachable (server down, or this laptop is off the tailnet) — leave the page
    // exactly as it is rather than half-marking it.
    if (sets === null) {
        console.log("Spadinh: couldn't reach dinhscogvery, leaving listings unmarked");
        return;
    }

    let removed = 0;

    for (const element of Array.from(document.getElementsByClassName(recordClass))) {
        const releaseId = dcvReleaseIdFromListing(element);

        if (releaseId === null || element.hasAttribute(DCV_PASSED_ATTR)) {
            continue;
        }

        if (sets.passed.has(releaseId)) {
            element.setAttribute(DCV_PASSED_ATTR, "");
            element.remove();
            removed++;
            continue;
        }

        if (sets.revisit.has(releaseId)) {
            element.classList.add(DCV_MARK_CLASS);
            element.title = "On the dinhscogvery Revisit list";
        }
    }

    if (removed > 0) {
        dcvUpdatePaginationText();
    }
}

// `updatePaginationText` lives in ratio-filter.js, which shares this isolated world. It reads
// page elements that a marketplace layout change could remove, so a failure here must never stop
// the marking that already happened.
function dcvUpdatePaginationText() {
    try {
        updatePaginationText();
    } catch (error) {
        console.log("Spadinh: couldn't update the record count text");
    }
}
