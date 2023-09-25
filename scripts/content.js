const recordClass = "shortcut_navigable";

ratioFilterKeysListener();
autoRatioFilterListener();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ratioFilter") {
        processRatioFilter(message.ratio);
        sendResponse({success: true})
    }

    if (message.action === "blindFilter") {
        processBlindBuys().then(r => sendResponse({success: true}))
    }
});

function autoRatioFilterListener() {
    chrome.storage.local.get(["autoRatioFilter"]).then((result) => {
        if (result.key !== null && result.autoRatioFilter !== undefined && result.autoRatioFilter === true) {
            autoProcessRatioFilter();
        }
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
            autoProcessRatioFilter();
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

function autoProcessRatioFilter() {
    let ratio = 0.75;
    chrome.storage.local.get(["spadinhRatio"]).then((result) => {
        if (result.key !== null && result.spadinhRatio !== undefined) {
            ratio = result.spadinhRatio;
        }
    });
    processRatioFilter(ratio);
}

function processRatioFilter(ratio) {
    const elements = document.getElementsByClassName(recordClass);

    for (const element of Array.from(elements)) {
        try {
            const have = parseFloat(element.getElementsByClassName("community_number")[0].innerHTML);
            const want = parseFloat(element.getElementsByClassName("community_label")[1].innerHTML);
            const itemRatio = want/have;

            if (itemRatio < ratio) {
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

async function processBlindBuys() {
    const elements = document.getElementsByClassName(recordClass);
    let elementsToRemove = [];

    for (const element of elements) {
        const href = element.querySelector("a").href;

        try {
            const response = await fetch(href);
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }

            const htmlContent = await response.text();
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = htmlContent;
            const containerIdentifier = ".section.video";
            const desiredTag = "h2";
            const videoContainer = tempDiv.querySelector(containerIdentifier);
            const videoHeaderText = videoContainer.querySelector(desiredTag).innerHTML;
            let isBlindBuy = !videoHeaderText.includes("(");

            if (!isBlindBuy) {
                elementsToRemove.push(element);
            }
        } catch (error) {
            console.error(`Error processing link ${href}: ${error}`);
        }
    }

    Array.from(elementsToRemove).forEach((element) => {
        element.remove();
    });

    sendTaskCompleteMessage();
}

function sendTaskCompleteMessage() {
    chrome.runtime.sendMessage({name: "taskComplete"})
}

function updatePaginationText() {
    const recordElements = document.getElementsByClassName(recordClass);
    const elements = document.getElementsByClassName("pagination_total");

    for (const element of Array.from(elements)) {
        const text = element.innerHTML;
        const textArray = text.split(" of ");
        const totalCountText = textArray[1];
        element.innerHTML = "Filtered List of 1 - " + recordElements.length + " of " + totalCountText;
    }
}