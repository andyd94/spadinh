document.addEventListener("DOMContentLoaded", function () {
    const removeButton = document.getElementById("ratio-filter");

    removeButton.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            chrome.runtime.sendMessage(
                {
                    tabId: activeTab.id,
                    action: "removeElements",
                },
                (response) => {
                    // Optionally handle the response from the content script
                }
            );
        });
    });
});