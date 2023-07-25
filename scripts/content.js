chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const targetClass = "shortcut_navigable";
    const elements = document.getElementsByClassName(targetClass);

    if (message.action === "ratioFilter") {
        processRatioFilter(message.ratio, elements);
        sendResponse({success: true})
    }

    if (message.action === "blindFilter") {
        processBlindBuys(elements).then(r => sendResponse({success: true}))
    }
});

function processRatioFilter(ratio, elements) {
    Array.from(elements).forEach((element) => {
        const have = parseFloat(element.querySelector(".community_label").innerHTML);
        const want = parseFloat(element.querySelectorAll(".community_number")[1].innerHTML);
        const itemRatio = want/have;

        if (itemRatio < ratio) {
            element.remove();
        }
    });

    taskComplete();
}

async function processBlindBuys(elements) {
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

    taskComplete();
}

function taskComplete() {
    chrome.runtime.sendMessage({name: "taskComplete"})
}