chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "blindFilter") {
        processBlindBuys().then(r => sendResponse({success: true}))
    }
});

async function processBlindBuys() {
    const elements = document.getElementsByClassName(recordClass);
    let elementsToRemove = [];

    for (const element of elements) {
        const href = element.querySelector(".item_release_link").href;

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