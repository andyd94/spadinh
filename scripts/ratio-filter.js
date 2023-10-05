let artistsToAvoid = [];
let labelsToAvoid = [];

init();

async function init() {
    if (!onSellerPage()) {
        return false;
    }

    ratioFilterListener();
    ratioFilterKeysListener();
    autoRatioFilterListener();
    loadPaginationListener();
    browseAllRecordsListener();
}


function ratioFilterListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "ratioFilter") {
            processRatioFilter(message.ratio);
            sendResponse({success: true})
        }
    });
}

function browseAllRecordsListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "browseAllRecords") {
            browseAllRecords();
        }
    });
}

function loadPaginationListener() {
    // Select the target element you want to watch
    const targetElement = document.getElementById("pjax_container");

    // Create a MutationObserver instance
    const observer = new MutationObserver((mutationsList) => {
        mutationsList.forEach((mutation) => {
            if (mutation.type === "attributes" && mutation.attributeName === "class") {
                // Check if the "watched-class" has been removed
                if (!targetElement.classList.contains("loading")) {
                    // Trigger your custom event here
                    const event = new Event("classRemoved");
                    targetElement.dispatchEvent(event);
                }
            }
        });
    });

    observer.observe(targetElement, { attributes: true });

    targetElement.addEventListener("classRemoved", () => loadPaginationHandler(), false);
}

async function loadPaginationHandler() {
    if (!await autoRatioFilterOn()) {
        return false;
    }

    autoRatioFilter();
}

function updatePaginationText() {
    const recordElements = document.getElementsByClassName(recordClass);
    const elements = document.getElementsByClassName("pagination_total");
    const elementCountPerPage = document.getElementById("limit_top").value;

    for (const element of Array.from(elements)) {
        const text = element.innerHTML;
        const textArray = text.split(" of ");
        const totalCountText = textArray[1];
        let displayedPageCount = elementCountPerPage;

        if (parseFloat(displayedPageCount) > parseFloat(totalCountText.replace(",", ""))) {
            displayedPageCount = totalCountText;
        }

        element.innerHTML = "Filtered list of " + recordElements.length + "/" + displayedPageCount + " records, out of " + totalCountText + " in total";
    }
}

async function autoRatioFilterListener() {
    if (!await autoRatioFilterOn()) {
        return false;
    }

    autoRatioFilter();
}

async function standardAutoRatioChecks() {
    const autoOn = await autoRatioFilterOn();
    const sellerPage = onSellerPage();

    return autoOn && sellerPage;
}

async function autoRatioFilterOn() {
    const result = await getAutoRatioFilter();
    return result.key !== null && result.autoRatioFilter !== undefined && result.autoRatioFilter === true;
}

async function getAutoRatioFilter() {
    return await chrome.storage.local.get(["autoRatioFilter"]).then((result) => {
        return result;
    });
}

async function getAvoidArtists() {
    return await chrome.storage.local.get(["avoidArtists"]).then((result) => {
        return result.avoidArtists.split(",");
    });
}

async function getAvoidLabels() {
    return await chrome.storage.local.get(["avoidLabels"]).then((result) => {
        return result.avoidLabels.split(",");
    });
}


function ratioFilterKeysListener() {
    // Initialize variables to track key states
    let ctrlPressed = false;
    let shiftPressed = false;

    document.addEventListener('keydown', function (event) {
        // Check for the Control (Ctrl) key press
        if (event.key === "Control") {
            ctrlPressed = true;
        }

        // Check for the Shift key press
        if (event.key === "Shift") {
            shiftPressed = true;
        }

        // Check if both Control and Shift keys are pressed
        if (ctrlPressed && shiftPressed) {
            autoRatioFilter();
        }
    });

    document.addEventListener('keyup', function (event) {
        // Reset the key states when the keys are released
        if (event.key === 'Control') {
            ctrlPressed = false;
        }

        if (event.key === 'Shift') {
            shiftPressed = false;
        }
    });
}

function autoRatioFilter() {
    let ratio = 0.75;
    
    chrome.storage.local.get(["spadinhRatio"]).then((result) => {
        if (result.key !== null && result.spadinhRatio !== undefined) {
            ratio = result.spadinhRatio;
        }
    });
    processRatioFilter(ratio);
}

async function processRatioFilter(ratio) {
    labelsToAvoid = await getAvoidLabels();
    artistsToAvoid = await getAvoidArtists();
    const elements = document.getElementsByClassName(recordClass);

    for (const element of Array.from(elements)) {
        try {
            const have = parseFloat(element.getElementsByClassName("community_number")[0].innerHTML);
            const want = parseFloat(element.getElementsByClassName("community_label")[1].innerHTML);
            const itemRatio = want/have;
            const ratioTooLow = itemRatio < ratio;

            if (ratioTooLow || artistAvoided(element) || labelAvoided(element)) {
                element.remove();
            }
        } catch (error) {
            console.log("Unable to remove the element below:");
            console.log(element)
        }
    }

    sendTaskCompleteMessage();
    updatePaginationText();
}

function artistAvoided(element) {
    try {
        const title = element.querySelector(".item_description_title").innerHTML;
        const artistName = title.split(" - ")[0].toLowerCase();

        return artistsToAvoid.includes(artistName);
    } catch(error) {
        return true;
    }
}

function labelAvoided(element) {
    try {
        const regex = /\(\d+\)/g;
        const labelName = element.querySelector(".label_and_cat a").innerHTML
            .replace(regex, "")
            .trim()
            .toLowerCase();

        return labelsToAvoid.includes(labelName);
    } catch(error) {
        return true;
    }
}




