document.addEventListener("DOMContentLoaded", function () {
    const ratioButton = document.getElementById("ratio-filter");
    ratioButton.addEventListener("click", activateRatioFilter);

    const ratioInput = document.getElementById("ratio");
    chrome.storage.local.get(["spadinhRatio"]).then((result) => {
        if (result.key !== null && result.spadinhRatio !== undefined) {
            ratioInput.value = result.spadinhRatio
        }
    });

    ratioInput.addEventListener("input", function () {
        chrome.storage.local.set({ spadinhRatio: ratioInput.value }).then(() => {
            console.log("Saved ratio value as " + ratioInput.value);

            chrome.storage.local.get(["spadinhRatio"]).then((result) => {
                console.log(result.spadinhRatio)
            });
        });
    });

    const blindButton = document.getElementById("blind-filter");
    blindButton.addEventListener("click", activateBlindFilter);
});

function activateRatioFilter() {
    const ratio = parseFloat(document.getElementById("ratio").value);

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "ratioFilter", ratio: ratio });
    });
}

function activateBlindFilter() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "blindFilter"});
    });
}