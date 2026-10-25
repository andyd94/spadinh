// Artist, label and search pages: every release row (or result card) gets a strip of what
// dinhscogvery knows about it - community haves, wants and rating, styles, whether there are
// clips (none means blind buy), instrumental tracks, where it stands (passed / owned / Revisit),
// and the taste score when dinhscogvery has one. Through the service worker (`dcvRows`): one
// query per artist or label page, and one lookup per batch of ids on a search page, whose
// results are anyone's. Rows that dinhscogvery doesn't carry (not EDM, so not in the mirror) are
// left as they are.
//
// Discogs renders these pages client-side and swaps the rows in place on paging and filtering,
// so the page is watched and new rows are decorated as they appear.

const DCV_ROWS_STRIP_CLASS = "spadinh-dcv-strip";
const DCV_ROWS_DONE_ATTR = "data-spadinh-dcv-row";
const DCV_ROWS_PASSED_CLASS = "spadinh-dcv-row-passed";
const DCV_ROWS_REVISIT_CLASS = "spadinh-dcv-row-revisit";
const DCV_ROWS_HIDDEN_CLASS = "spadinh-dcv-row-hidden";
// The popup's blind-buy / instrumental filters; a class of their own so they and the ratio
// filter don't undo each other.
const DCV_ROWS_FILTERED_CLASS = "spadinh-dcv-row-filtered";
// Wrapped in :is() so a suffix (" tbody tr") applies to both tables.
const DCV_ROWS_TABLE = ':is(table[class*="releases_"], table[class*="labelReleasesTable_"])';
// Search results are a grid of cards; the artist and label cards among them have no release
// link and fall out in the lookup.
const DCV_ROWS_CARD = 'div[role="listitem"]';
const DCV_ROWS_DEBOUNCE_MS = 250;

// The filter bar (see further down). Declared up here with the rest: the stylesheet that
// `dcvRowsInit` injects first thing refers to the id.
const DCV_BAR_ID = "spadinh-dcv-bar";
const DCV_BAR_FILTERS = [
    { key: "dcvBlindBuysOnly", label: "blind buys only", title: "show only rows with no clips on the release or its master" },
    { key: "dcvInstrumentalsOnly", label: "instrumentals only", title: "show only rows with an instrumental track" }
];

// What the bar's filters leave showing right now, and what the ratio filter is hiding.
let dcvRowsFilterShown = 0;
let dcvRowsFilterTotal = 0;
let dcvRowsRatioState = null;

// Rows keyed by release id and by master id: per artist/label page seen in this tab, and one
// growing index for search results, with the ids already asked for.
const dcvRowsByPage = new Map();
const dcvRowsSearchIndex = { byId: new Map(), byMaster: new Map(), requested: new Set() };
// What each decorated row showed, for the ratio filter.
const dcvRowsInfo = new WeakMap();
let dcvRowsTimer = null;
let dcvRowsApplying = false;

dcvRowsInit();

// /artist/27226-Soultek, /label/10292-Discomagic-Records (and their paged/filtered forms),
// /seller/dj_venser/profile (the listings dinhscogvery has mirrored for that seller), and
// /search?q=… whose results can be anyone's.
function dcvRowsPage() {
    const path = window.location.pathname;
    const match = path.match(/^\/(artist|label)\/(\d+)/);

    if (match) {
        return { kind: match[1], id: parseInt(match[2], 10) };
    }

    const seller = path.match(/^\/seller\/([^/]+)/);

    if (seller) {
        return { kind: "seller", id: decodeURIComponent(seller[1]) };
    }

    return /^\/search\/?$/.test(path) ? { kind: "search", id: 0 } : null;
}

function dcvRowsSelector(page) {
    switch (page.kind) {
        case "search":
            return DCV_ROWS_CARD;
        case "seller":
            // The marketplace listings, as the ratio filter and marks know them.
            return "." + recordClass;
        default:
            return DCV_ROWS_TABLE + " tbody tr";
    }
}

async function dcvRowsInit() {
    if (!dcvRowsPage()) {
        return;
    }

    dcvRowsInjectStyle();
    await dcvRowsBuildBar();
    dcvRowsObserve();
    await dcvRowsApply();
}

// --- The filter bar ------------------------------------------------------------------------------
//
// A small fixed bar in the bottom-left corner (the toasts are bottom-right) with the two filters
// dinhscogvery's own result list has - blind buys, no instrumental - and what's being hidden
// right now, the ratio filter's doing included, so a filter can't be on without it showing.
// Appended to <body> outside anything Discogs renders, so its re-renders never touch it. The
// toggles are remembered across pages, like the ratio.

// Idempotent, and called again on every pass over the rows: the search page's React app hydrates
// the whole document and throws out body children that were there before it, the bar included.
async function dcvRowsBuildBar() {
    if (document.getElementById(DCV_BAR_ID)) {
        return;
    }

    const settings = await chrome.storage.local.get(DCV_BAR_FILTERS.map((filter) => filter.key).concat("dcvBarCollapsed"));
    const bar = document.createElement("div");

    bar.id = DCV_BAR_ID;
    bar.classList.toggle("collapsed", settings.dcvBarCollapsed === true);

    const handle = document.createElement("button");

    handle.type = "button";
    handle.className = "handle";
    handle.title = "dinhscogvery filters";
    handle.addEventListener("click", () => {
        bar.classList.toggle("collapsed");
        chrome.storage.local.set({ dcvBarCollapsed: bar.classList.contains("collapsed") });
    });
    bar.appendChild(handle);

    const body = document.createElement("div");

    body.className = "body";

    for (const filter of DCV_BAR_FILTERS) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");

        checkbox.type = "checkbox";
        checkbox.checked = settings[filter.key] === true;
        checkbox.addEventListener("change", async () => {
            await chrome.storage.local.set({ [filter.key]: checkbox.checked });
            await dcvRowsApplyFilters();
        });

        label.title = filter.title;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(filter.label));
        body.appendChild(label);
    }

    const status = document.createElement("span");

    status.className = "status";
    body.appendChild(status);

    const ratio = document.createElement("button");

    ratio.type = "button";
    ratio.className = "ratio";
    ratio.title = "the ratio filter's doing - click to show those rows again";
    ratio.addEventListener("click", () => dcvRowsRatioFilter(0));
    body.appendChild(ratio);

    bar.appendChild(body);
    document.body.appendChild(bar);
    dcvRowsUpdateBar();
}

function dcvRowsUpdateBar() {
    const bar = document.getElementById(DCV_BAR_ID);

    if (!bar) {
        return;
    }

    const anyOn = Array.from(bar.querySelectorAll("input")).some((checkbox) => checkbox.checked);
    const status = bar.querySelector(".status");
    const ratio = bar.querySelector(".ratio");

    status.textContent = anyOn ? dcvRowsFilterShown + " of " + dcvRowsFilterTotal : "";
    ratio.textContent = dcvRowsRatioState && dcvRowsRatioState.hidden > 0
        ? "ratio ≥ " + dcvRowsRatioState.ratio + " hiding " + dcvRowsRatioState.hidden + " ×"
        : "";
    ratio.hidden = ratio.textContent === "";
    bar.classList.toggle("active", anyOn || !ratio.hidden);
}

// The bar's filters, over every decorated row - positive ones, like dinhscogvery's: "blind buys
// only" keeps the rows with no clips on the release or its master, "instrumentals only" the rows
// with an instrumental track, both together the rows that are both. While one is on, a row
// dinhscogvery doesn't know goes too: it can't be shown to match. (The ratio filter is the other
// way round and keeps such rows.)
async function dcvRowsApplyFilters() {
    const page = dcvRowsPage();

    if (!page) {
        return;
    }

    const settings = await chrome.storage.local.get(DCV_BAR_FILTERS.map((filter) => filter.key));
    const blindBuysOnly = settings.dcvBlindBuysOnly === true;
    const instrumentalsOnly = settings.dcvInstrumentalsOnly === true;
    const anyOn = blindBuysOnly || instrumentalsOnly;
    let shown = 0;
    let total = 0;

    for (const row of document.querySelectorAll(dcvRowsSelector(page) + "[" + DCV_ROWS_DONE_ATTR + "]")) {
        const info = dcvRowsInfo.get(row);
        const matches = !!info && !(blindBuysOnly && info.videos !== 0) && !(instrumentalsOnly && info.instrumentals === 0);
        const out = anyOn && !matches;

        row.classList.toggle(DCV_ROWS_FILTERED_CLASS, out);
        total++;

        if (!out) {
            shown++;
        }
    }

    dcvRowsFilterShown = shown;
    dcvRowsFilterTotal = total;
    dcvRowsUpdateBar();
}

function dcvRowsInjectStyle() {
    const style = document.createElement("style");

    // Translucent so it reads on Discogs' light and dark themes alike.
    style.textContent = [
        "." + DCV_ROWS_STRIP_CLASS + " { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; font-size: 11px; line-height: 16px; }",
        "." + DCV_ROWS_STRIP_CLASS + " > span { padding: 0 6px; border-radius: 4px; background: rgba(128, 128, 128, 0.16); white-space: nowrap; }",
        "." + DCV_ROWS_STRIP_CLASS + " > .warn { background: rgba(229, 62, 62, 0.2); }",
        "." + DCV_ROWS_STRIP_CLASS + " > .good { background: rgba(79, 209, 197, 0.22); }",
        "." + DCV_ROWS_STRIP_CLASS + " > .state { font-weight: 600; }",
        "." + DCV_ROWS_PASSED_CLASS + " { opacity: 0.5; }",
        "." + DCV_ROWS_REVISIT_CLASS + " { background-color: rgba(79, 209, 197, 0.12) !important; }",
        "." + DCV_ROWS_REVISIT_CLASS + " > td:first-child { box-shadow: inset 4px 0 0 #319795; }",
        "div." + DCV_ROWS_REVISIT_CLASS + " { box-shadow: inset 4px 0 0 #319795; border-radius: 6px; }",
        "." + DCV_ROWS_HIDDEN_CLASS + ", ." + DCV_ROWS_FILTERED_CLASS + " { display: none !important; }",
        "#" + DCV_BAR_ID + " { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 6px; border-radius: 8px; background: #2d3748; color: #e2e8f0; font: 600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); }",
        "#" + DCV_BAR_ID + " .handle { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: #4a5568; cursor: pointer; flex: none; }",
        "#" + DCV_BAR_ID + ".active .handle { background: #319795; }",
        "#" + DCV_BAR_ID + " .body { display: flex; align-items: center; gap: 10px; }",
        "#" + DCV_BAR_ID + ".collapsed .body { display: none; }",
        "#" + DCV_BAR_ID + ".collapsed { padding: 6px; }",
        "#" + DCV_BAR_ID + " label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }",
        "#" + DCV_BAR_ID + " input { margin: 0; }",
        "#" + DCV_BAR_ID + " .status { color: #fc8181; white-space: nowrap; }",
        "#" + DCV_BAR_ID + " .ratio { padding: 0 6px; border: 0; border-radius: 4px; background: rgba(252, 129, 129, 0.2); color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }"
    ].join("\n");

    document.head.appendChild(style);
}

// Paging, filtering and moving to another artist or label all happen without a page load; any
// rows added anywhere are enough of a cue, debounced since a render adds them in a burst.
function dcvRowsObserve() {
    const bar = document.getElementById(DCV_BAR_ID);
    const observer = new MutationObserver((mutations) => {
        if (!mutations.some((mutation) => mutation.addedNodes.length > 0 && !(bar && bar.contains(mutation.target)))) {
            return;
        }

        clearTimeout(dcvRowsTimer);
        dcvRowsTimer = setTimeout(dcvRowsApply, DCV_ROWS_DEBOUNCE_MS);
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function dcvRowsRequest(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(Object.assign({ action: "dcvRows" }, message), (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
                console.log("Spadinh: couldn't get dinhscogvery's rows for this page",
                    response ? response.text : chrome.runtime.lastError);
                resolve(null);
                return;
            }

            resolve(response.rows);
        });
    });
}

function dcvRowsAddToIndex(index, rows) {
    for (const row of rows) {
        index.byId.set(row.id, row);

        if (row.masterId) {
            if (!index.byMaster.has(row.masterId)) {
                index.byMaster.set(row.masterId, []);
            }

            index.byMaster.get(row.masterId).push(row);
        }
    }
}

// The release or master id a row (or card) links to.
function dcvRowsLinkedId(row) {
    const link = row.querySelector('a[href*="/release/"], a[href*="/master/"]');
    const match = link ? link.getAttribute("href").match(/\/(release|master)\/(\d+)/) : null;

    return match ? { kind: match[1], id: parseInt(match[2], 10) } : null;
}

// The index to decorate `pending` from: the whole artist or label in one query, or, on a search
// page, whatever these cards link to that hasn't been asked for yet.
async function dcvRowsIndexFor(page, pending) {
    if (page.kind !== "search") {
        const key = page.kind + ":" + page.id;

        if (dcvRowsByPage.has(key)) {
            return dcvRowsByPage.get(key);
        }

        const rows = await dcvRowsRequest({ kind: page.kind, id: page.id });

        if (rows === null) {
            return null;
        }

        // Worth saying once: a seller with nothing in dinhscogvery hasn't been mirrored, and
        // otherwise the page just looks like the extension did nothing.
        if (page.kind === "seller" && rows.length === 0) {
            spadinhShowToast("dinhscogvery hasn't mirrored " + page.id + "'s listings");
        }

        const index = { byId: new Map(), byMaster: new Map() };

        dcvRowsAddToIndex(index, rows);
        dcvRowsByPage.set(key, index);

        return index;
    }

    const index = dcvRowsSearchIndex;
    const releaseIds = [];
    const masterIds = [];

    for (const row of pending) {
        const linked = dcvRowsLinkedId(row);
        const key = linked ? linked.kind + ":" + linked.id : null;

        if (!linked || index.requested.has(key)) {
            continue;
        }

        index.requested.add(key);
        (linked.kind === "release" ? releaseIds : masterIds).push(linked.id);
    }

    if (releaseIds.length === 0 && masterIds.length === 0) {
        return index;
    }

    const rows = await dcvRowsRequest({ kind: "ids", releaseIds: releaseIds, masterIds: masterIds });

    if (rows === null) {
        // Ask again next time these cards come round.
        releaseIds.forEach((id) => index.requested.delete("release:" + id));
        masterIds.forEach((id) => index.requested.delete("master:" + id));

        return null;
    }

    dcvRowsAddToIndex(index, rows);

    return index;
}

async function dcvRowsApply() {
    const page = dcvRowsPage();

    if (!page || dcvRowsApplying) {
        return;
    }

    await dcvRowsBuildBar();

    const pending = Array.from(document.querySelectorAll(dcvRowsSelector(page)))
        .filter((row) => !row.hasAttribute(DCV_ROWS_DONE_ATTR));

    if (pending.length === 0) {
        return;
    }

    dcvRowsApplying = true;

    try {
        const index = await dcvRowsIndexFor(page, pending);

        // dinhscogvery unreachable: leave the page as it is, and try again on the next render.
        if (index === null) {
            return;
        }

        for (const row of pending) {
            row.setAttribute(DCV_ROWS_DONE_ATTR, "");
            dcvRowsDecorate(row, index);
        }

        await dcvRowsApplyFilters();

        // The popup's "auto" applies here as on a seller page, once the rows have their numbers.
        // On the seller page itself ratio-filter.js already runs it off the listing's own figures.
        if (page.kind !== "seller" && await autoRatioFilterOn()) {
            autoRatioFilter();
        }
    } finally {
        dcvRowsApplying = false;
    }
}

// The ratio filter for these pages (ratio-filter.js hands over to this): rows whose want/have
// from dinhscogvery is under `ratio` are hidden, not removed, so a lower ratio and another
// Filter brings them back. Rows with no figures - not in dinhscogvery, or no community numbers
// fetched yet - are left showing.
function dcvRowsRatioFilter(ratio) {
    const page = dcvRowsPage();
    let hidden = 0;
    let total = 0;

    if (!page) {
        return;
    }

    for (const row of document.querySelectorAll(dcvRowsSelector(page) + "[" + DCV_ROWS_DONE_ATTR + "]")) {
        const info = dcvRowsInfo.get(row);

        total++;

        if (!info || !(info.have > 0) || info.want === null || info.want === undefined) {
            row.classList.remove(DCV_ROWS_HIDDEN_CLASS);
            continue;
        }

        const tooLow = info.want / info.have < ratio;

        row.classList.toggle(DCV_ROWS_HIDDEN_CLASS, tooLow);

        if (tooLow) {
            hidden++;
        }
    }

    dcvRowsRatioState = { ratio: ratio, hidden: hidden };
    dcvRowsUpdateBar();
    spadinhShowToast("ratio ≥ " + ratio + ": hid " + hidden + " of " + total + " rows");
}

// A row links either a release or, for the grouped entries, a master; a master shows the version
// dinhscogvery rates most wanted, and says how many it holds.
function dcvRowsLookup(row, index) {
    const linked = dcvRowsLinkedId(row);

    if (!linked) {
        return null;
    }

    if (linked.kind === "release") {
        const info = index.byId.get(linked.id);

        return info ? { info: info, versions: 1 } : null;
    }

    const versions = index.byMaster.get(linked.id);

    if (!versions || versions.length === 0) {
        return null;
    }

    const best = versions.reduce((top, candidate) => ((candidate.want || 0) > (top.want || 0) ? candidate : top));

    return { info: best, versions: versions.length };
}

function dcvRowsDecorate(row, index) {
    const found = dcvRowsLookup(row, index);

    if (!found) {
        return;
    }

    const info = found.info;
    const strip = document.createElement("div");

    dcvRowsInfo.set(row, info);
    const badge = (text, className, title) => {
        const span = document.createElement("span");

        span.textContent = text;

        if (className) {
            span.className = className;
        }

        if (title) {
            span.title = title;
        }

        strip.appendChild(span);
    };

    strip.className = DCV_ROWS_STRIP_CLASS;

    // A seller listing already prints its rating, haves and wants, and dinhscogvery-marks.js
    // already removes passed listings and tints Revisit ones; there, only the rest goes on.
    const onSeller = dcvRowsPage().kind === "seller";

    if (!onSeller && info.have !== null && info.have !== undefined) {
        const ratio = info.have > 0 && info.want !== null ? (info.want / info.have).toFixed(2) : "–";

        badge(info.have + " have · " + info.want + " want", "", "want/have ratio " + ratio);
    }

    if (!onSeller && info.rating !== null && info.rating !== undefined) {
        badge("★ " + Number(info.rating).toFixed(2) + " (" + info.ratingCount + ")", "", "community rating");
    }

    if (info.styles.length > 0) {
        badge(info.styles.join(" · "), "", "styles");
    }

    if (info.videos === 0) {
        badge("no clips", "warn", "no videos on the release or its master: blind buy");
    }

    if (info.instrumentals > 0) {
        badge("instr " + info.instrumentals + "/" + info.tracks, "good", "instrumental tracks");
    }

    if (info.taste !== null && info.taste !== undefined) {
        badge("taste " + info.taste, "good", (info.tasteWhy || []).join("\n") || "dinhscogvery taste score");
    }

    if (info.state === "passed") {
        badge("passed", "state", "passed in dinhscogvery");

        if (!onSeller) {
            row.classList.add(DCV_ROWS_PASSED_CLASS);
        }
    } else if (info.state === "owned") {
        badge("owned", "state", "in your collection");
    }

    if (info.revisit) {
        badge("revisit", "state good", "on the dinhscogvery Revisit list");

        if (!onSeller) {
            row.classList.add(DCV_ROWS_REVISIT_CLASS);
        }
    }

    if (found.versions > 1) {
        badge(found.versions + " versions", "", "versions dinhscogvery holds; figures are the most wanted one's");
    }

    // Under the title, inside its cell (at the foot of a search card, under a listing's
    // description): survives whatever Discogs does with the other columns.
    const cell = row.querySelector('td[class*="title_"], .hifi-catalog-listing-card-content, .item_description') ||
        row.querySelector("td:nth-child(3)") || row.lastElementChild;

    cell.appendChild(strip);
}
