const recordClass = "shortcut_navigable";

function sendTaskCompleteMessage() {
    chrome.runtime.sendMessage({name: "taskComplete"})
}

function browseAllRecords() {
    const elements = document.getElementsByClassName(recordClass);

    for (const element of Array.from(elements)) {
        const releaseUrl = element.querySelector(".item_release_link").href;
        window.open(releaseUrl, '_blank');
    }
}