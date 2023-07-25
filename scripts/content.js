chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const targetClass = "shortcut_navigable";
    const elements = document.getElementsByClassName(targetClass);

    if (message.action === "ratioFilter") {
        processRatioFilter(message.ratio);
    }

    if (message.action === "blindFilter") {
        processBlindBuys().then(r => alert("Finished filtering blinds"));
    }
});

function processRatioFilter(ratio) {
    const elements = document.getElementsByClassName("shortcut_navigable");

    Array.from(elements).forEach((element) => {
        const have = parseFloat(element.querySelector(".community_label").innerHTML);
        const want = parseFloat(element.querySelectorAll(".community_number")[1].innerHTML);
        const itemRatio = want/have;

        if (itemRatio < ratio) {
            element.remove();
        }
    });

    alert("Finished filtering by ratio");
}

async function processBlindBuys() {
    const targetClass = "shortcut_navigable";
    const elements = document.getElementsByClassName(targetClass);
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
}