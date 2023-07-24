chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const targetClass = "shortcut_navigable";
    const elements = document.getElementsByClassName(targetClass);

    if (message.action == "ratioFilter") {
        //elements = document.getElementsByClassName("shortcut_navigable");
        const ratio = message.ratio;

        Array.from(elements).forEach((element) => {
            const haveWantElements = element.getElementsByClassName("community_number");
            const have = parseFloat(element.querySelector(".community_label").innerHTML);
            const want = parseFloat(element.querySelectorAll(".community_number")[1].innerHTML);
            const itemRatio = want/have;
            const recordName = element.querySelector(".item_description_title").innerHTML
            console.log("record is " + recordName)
            console.log("ratio: " + ratio);
            console.log("item ratio: " + itemRatio);

            if (itemRatio < ratio) {
                console.log("removing item " + recordName);
                element.remove();
            }
        });
    }

    if (message.action == "blindFilter") {
        console.log("blindy");
        processBlindBuys();

        // Array.from(elements).forEach((element) => {
        //     // Open the link in a new tab
        //     const link = element.querySelector(".item_description_title").href
        //     const tab = window.open(link, '_blank');
        //
        //     // Wait for the page to load
        //     tab.addEventListener('load', () => {
        //         // Evaluate the content of the visited page
        //         const pageContent = tab.document.body.textContent;
        //         const videoTitle = tab.document.querySelector(".head_WZcFZ");
        //         const videosPresent = tab.document.querySelector(".videos_1xVCN li") !== null
        //         console.log(videosPresent);
        //         // Check if the page content satisfies your condition
        //         if (videosPresent) {
        //             // Remove the link from the list
        //             element.remove();
        //         }
        //
        //         // Close the tab after evaluating the content
        //         tab.close();
        //     });
        // });
    }
});

async function processBlindBuys() {
    const targetClass = "shortcut_navigable";
    const elements = document.getElementsByClassName(targetClass);

    var count = 0
    // Loop through the links and check each one
    for (const element of elements) {
        const href = element.querySelector("a").href;
        count++;

        // Make an HTTP GET request to retrieve the HTML content of the link's URL
        try {
            const response = await fetch(href);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const htmlContent = await response.text();

            // Create a temporary div element to hold the HTML content for manipulation
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;

            // Check if the HTML content contains elements with the desired class that don't contain specified tags
            const desiredClass = "head_WZcFZ"; // Replace 'example-class' with the desired class name
            const desiredTag = "li"; // Replace 'div' with the desired HTML tag name

            const elementsWithClass = tempDiv.querySelectorAll(`.${desiredClass}`);
            let containsDesiredTag = false;

            elementsWithClass.forEach((element) => {
                const matchingElements = element.querySelectorAll(desiredTag);
                if (matchingElements.length === 0) {
                    containsDesiredTag = true;
                }
            });

            if (containsDesiredTag) {
                element.remove();
                console.log("Removed " + href)
            }
        } catch (error) {
            console.error(`Error processing link ${href}: ${error}`);
        }
    }

    alert("Finished filtering blinds");
}