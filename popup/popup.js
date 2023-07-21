document.addEventListener("DOMContentLoaded", function () {
    const ratioButton = document.getElementById("ratio-filter");
    ratioButton.addEventListener("click", activateRatioFilter);

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
    const ratio = parseFloat(document.getElementById("ratio").value);

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "blindFilter"});
    });
}