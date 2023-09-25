document.addEventListener("DOMContentLoaded", () => {
    const ratioButton = document.getElementById("ratio-filter");
    const ratioInput = document.getElementById("ratio");
    const blindButton = document.getElementById("blind-filter");
    const instrumentalButton = document.getElementById("instrumental-filter");
    const autoRatioFilterCheck = document.getElementById("auto-ratio-filter");

    ratioButton.addEventListener("click", activateRatioFilter);
    blindButton.addEventListener("click", activateBlindFilter);
    instrumentalButton.addEventListener("click", activateInstrumentalFilter);

    autoRatioFilterCheck.addEventListener("click", () => {
        chrome.storage.local.set({ autoRatioFilter: autoRatioFilterCheck.checked }).then(() => {
            console.log("Saved auto ratio filter value as " + autoRatioFilterCheck.checked);
        });
    });

    chrome.storage.local.get(["autoRatioFilter"]).then((result) => {
        if (result.key !== null && result.autoRatioFilter !== undefined) {
            autoRatioFilterCheck.checked = result.autoRatioFilter;
        }
    });

    ratioInput.addEventListener("input", () => {
        chrome.storage.local.set({ spadinhRatio: ratioInput.value }).then(() => {
            console.log("Saved ratio value as " + ratioInput.value);
        });
    });

    chrome.storage.local.get(["spadinhRatio"]).then((result) => {
        if (result.key !== null && result.spadinhRatio !== undefined) {
            ratioInput.value = result.spadinhRatio;
        }
    });
});


function activateRatioFilter() {
    const ratio = parseFloat(document.getElementById("ratio").value);
    showLoadingIcon();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "ratioFilter", ratio: ratio });
    });
}

function activateBlindFilter() {
    showLoadingIcon();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "blindFilter"});
    });
}

function activateInstrumentalFilter() {
    const instrumentalString = "instrumental|dubstrumental|dubstramenal|dub&";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        let url = tabs[0].url
        const indexOfPageString = url.indexOf("page=") - 1;
        const endIndexOfPageString = indexOfPageString + 7;
        const pageString = url.substring(indexOfPageString, endIndexOfPageString);
        url = url.replace(pageString, "");
        const newUrl = url.replace("?", "?q=" + instrumentalString);

        chrome.tabs.update({ url: newUrl });
    });
}

function showLoadingIcon() {
    const loading = document.getElementById("loading");
    loading.classList.remove("hidden");
}

function hideLoadingIcon() {
    const loading = document.getElementById("loading");
    loading.classList.add("hidden");
}

chrome.runtime.onMessage.addListener(({ name }) => {
    if (name === "taskComplete") {
        hideLoadingIcon();
    }
});