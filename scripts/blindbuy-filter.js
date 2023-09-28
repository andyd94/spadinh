const recordClass = "shortcut_navigable";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "blindFilter") {
        processBlindBuys().then(r => sendResponse({success: true}))
    }
});

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