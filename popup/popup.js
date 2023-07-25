document.addEventListener("DOMContentLoaded", () => {
    const ratioButton = document.getElementById("ratio-filter");
    const ratioInput = document.getElementById("ratio");
    const blindButton = document.getElementById("blind-filter");

    ratioButton.addEventListener("click", activateRatioFilter);
    blindButton.addEventListener("click", activateBlindFilter);

    ratioInput.addEventListener("input", () => {
        chrome.storage.local.set({ spadinhRatio: ratioInput.value }).then(() => {
            console.log("Saved ratio value as " + ratioInput.value);

            chrome.storage.local.get(["spadinhRatio"]).then((result) => {
                console.log(result.spadinhRatio);
            });
        });
    });

    chrome.storage.local.get(["spadinhRatio"]).then((result) => {
        if (result.key !== null && result.spadinhRatio !== undefined) {
            ratioInput.value = result.spadinhRatio
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