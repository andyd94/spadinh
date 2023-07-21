chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const targetClass = "shortcut_navigable";
    const elements = document.getElementsByClassName(targetClass);

    if (message.action == "ratioFilter") {
        //elements = document.getElementsByClassName("shortcut_navigable");
        const ratio = message.ratio;

        Array.from(elements).forEach((element) => {
            const haveWantElements = element.getElementsByClassName("community_number");
            const have = parseFloat(haveWantElements[0].innerHTML);
            const want = parseFloat(haveWantElements[1].innerHTML);
            const itemRatio = want/have;
            // const recordName = element.querySelector(".item_description_title").innerHTML
            // console.log("record is " + recordName)
            // console.log("ratio: " + ratio);
            // console.log("item ratio: " + itemRatio);

            if (itemRatio < ratio) {
                // console.log("removing item " + recordName);
                element.remove();
            }
        });
    }

    if (message.action == "blindFilter") {
        console.log("blindy");
        Array.from(elements).forEach((element) => {
            // Open the link in a new tab
            const link = element.querySelector(".item_description_title").href
            const tab = window.open(link, '_blank');

            // Wait for the page to load
            tab.addEventListener('load', () => {
                // Evaluate the content of the visited page
                const pageContent = tab.document.body.textContent;
                const videoTitle = tab.document.querySelector(".head_WZcFZ");
                const videosPresent = tab.document.querySelector(".videos_1xVCN li") !== null
                console.log(videosPresent);
                // Check if the page content satisfies your condition
                if (videosPresent) {
                    // Remove the link from the list
                    element.remove();
                }

                // Close the tab after evaluating the content
                tab.close();
            });
        });
    }
});