document.addEventListener("DOMContentLoaded", () => {
    const ratioButton = document.getElementById("ratio-filter");
    const ratioInput = document.getElementById("ratio");
    const instrumentalButton = document.getElementById("instrumental-filter");
    const autoRatioFilterCheck = document.getElementById("auto-ratio-filter");
    const browseAllRecordsButton = document.getElementById("browse-all-records");
    const artistTextArea = document.getElementById("avoid-artists");
    const labelTextArea = document.getElementById("avoid-labels");

    ratioButton.addEventListener("click", activateRatioFilter);
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

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "ratioFilter", ratio: ratio });
    });
}

function activateInstrumentalFilter() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = new URL(tabs[0].url);
        const instrumentalString = "instrumental|dubstrumental|dubstramenal|dub&";

        currentUrl.searchParams.set('q', instrumentalString);

        chrome.tabs.update({ url: currentUrl.toString() });
    });
}
