document.addEventListener("DOMContentLoaded", () => {
    const ratioButton = document.getElementById("ratio-filter");
    const ratioInput = document.getElementById("ratio");
    const blindButton = document.getElementById("blind-filter");
    const instrumentalButton = document.getElementById("instrumental-filter");
    const autoRatioFilterCheck = document.getElementById("auto-ratio-filter");
    const browseAllRecordsButton = document.getElementById("browse-all-records");
    const artistTextArea = document.getElementById("avoid-artists");
    const labelTextArea = document.getElementById("avoid-labels");

    ratioButton.addEventListener("click", activateRatioFilter);
    blindButton.addEventListener("click", activateBlindFilter);
    instrumentalButton.addEventListener("click", activateInstrumentalFilter);
    browseAllRecordsButton.addEventListener("click", activateBrowseAllRecords);

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

    artistTextArea.addEventListener("input", () => {
        chrome.storage.local.set({ avoidArtists: artistTextArea.value }).then(() => {
            console.log("Saved avoid artists value as " + artistTextArea.value);
        });
    });

    chrome.storage.local.get(["avoidArtists"]).then((result) => {
        if (result.key !== null && result.avoidArtists !== undefined) {
            artistTextArea.value = result.avoidArtists;
        }
    });

    labelTextArea.addEventListener("input", () => {
        chrome.storage.local.set({ avoidLabels: labelTextArea.value }).then(() => {
            console.log("Saved avoid artists value as " + labelTextArea.value);
        });
    });

    chrome.storage.local.get(["avoidLabels"]).then((result) => {
        if (result.key !== null && result.avoidLabels !== undefined) {
            labelTextArea.value = result.avoidLabels;
        }
    });
});

function activateBrowseAllRecords() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "browseAllRecords" });
    });
}


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