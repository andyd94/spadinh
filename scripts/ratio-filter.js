const recordClass = "shortcut_navigable";

ratioFilterKeysListener();
autoRatioFilterListener();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ratioFilter") {
        processRatioFilter(message.ratio);
        sendResponse({success: true})
    }
});

function autoRatioFilterListener() {
    if (!autoRatioFilterOn()) {
        return false;
    }

    autoProcessRatioFilter();

    // chrome.storage.local.get(["autoRatioFilter"]).then((result) => {
    //     if (result.key !== null && result.autoRatioFilter !== undefined && result.autoRatioFilter === true) {
    //         autoProcessRatioFilter();
    //     }
    // });
}

async function autoRatioFilterOn() {
    const result = await getAutoRatioFilter();
    return result.key !== null && result.autoRatioFilter !== undefined && result.autoRatioFilter === true;
}

async function getAutoRatioFilter() {
    // const readLocalStorage = async (key) => {
    //     return new Promise((resolve, reject) => {
    //         chrome.storage.local.get([key], function (result) {
    //             if (result[key] === undefined) {
    //                 reject();
    //             } else {
    //                 resolve(result);
    //             }
    //         });
    //     });
    // };
    //
    // return readLocalStorage();

    return await chrome.storage.local.get(["autoRatioFilter"]).then((result) => {
        return result;
    });
}

function ratioFilterKeysListener() {
    // Initialize variables to track key states
    let ctrlPressed = false;
    let shiftPressed = false;

    document.addEventListener('keydown', function (event) {
        // Check for the Control (Ctrl) key press
        if (event.key === "Control") {
            ctrlPressed = true;
        }

        // Check for the Shift key press
        if (event.key === "Shift") {
            shiftPressed = true;
        }

        // Check if both Control and Shift keys are pressed
        if (ctrlPressed && shiftPressed) {
            autoProcessRatioFilter();
        }
    });

    document.addEventListener('keyup', function (event) {
        // Reset the key states when the keys are released
        if (event.key === 'Control') {
            ctrlPressed = false;
        }

        if (event.key === 'Shift') {
            shiftPressed = false;
        }
    });
}

function autoProcessRatioFilter() {
    let ratio = 0.75;
    chrome.storage.local.get(["spadinhRatio"]).then((result) => {
        if (result.key !== null && result.spadinhRatio !== undefined) {
            ratio = result.spadinhRatio;
        }
    });
    processRatioFilter(ratio);
}

function processRatioFilter(ratio) {
    const elements = document.getElementsByClassName(recordClass);

    for (const element of Array.from(elements)) {
        try {
            const have = parseFloat(element.getElementsByClassName("community_number")[0].innerHTML);
            const want = parseFloat(element.getElementsByClassName("community_label")[1].innerHTML);
            const itemRatio = want/have;

            if (itemRatio < ratio) {
                element.remove();
            }
        } catch (error) {
            console.log("Unable to remove the element below:");
            console.log(element)
        }
    }

    sendTaskCompleteMessage();
    updatePaginationText();
}