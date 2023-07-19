chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "removeElements") {
        removeElements();
    }
});

function removeElements() {
    console.log("yo")
}