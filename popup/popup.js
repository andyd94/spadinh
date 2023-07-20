document.addEventListener("DOMContentLoaded", function () {
    const removeButton = document.getElementById("ratio-filter");
    removeButton.addEventListener("click", activateRatioFilter);
});

async function activateRatioFilter() {
    const tab = await getCurrentTab();
    const ratio = parseFloat(document.getElementById("ratio").value);

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "ratioFilter", ratio: ratio });
    });

    // chrome.scripting.executeScript({
    //     target: { tabId: tab.id },
    //     files: ["scripts/content.js"],
    // });
}

function filterByRatio(ratio) {
    const elements = document.getElementsByClassName("shortcut_navigable")
    console.log(elements)

    Array.from(elements).forEach((element) => {
        const haveWantElements = element.querySelector(".community_result");
        const have = haveWantElements[0].innerHTML;
        const want = haveWantElements[1].innerHTML;

        console.log(have);
        console.log(want);

        if (have/want < ratio) {
            element.remove();
        }
    });
}

async function getCurrentTab() {
    const queryOptions = { active: true, currentWindow: true };
    const [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}