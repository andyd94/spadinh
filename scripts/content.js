

// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//     // 2. A page requested user data, respond with a copy of `user`
//     console.log("content received")
//
//     if (message.action == "ratioFilter") {
//         console.log("content received")
//     }
// });

// chrome.runtime.onmessage.addListener((message) => {
//     if (message.action === "ratioFilter") {
//         alert("yoooo")
//         // Query active tab to retrieve matching elements
//         // const targetClass = "shortcut_navigable";
//         // const elements = document.getElementsByClassName(targetClass);
//         // const ratio = message.ratio;
//         //
//         // Array.from(elements).forEach((element) => {
//         //     const haveWantElements = element.querySelector(".community_result");
//         //     const have = haveWantElements[0];
//         //     const want = haveWantElements[1];
//         //
//         //     if (have/want < ratio) {
//         //         element.remove();
//         //     }
//         // });
//
//         // chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
//         //     const activeTab = tabs[0];
//         //
//         //     // Execute script to remove elements based on specified criteria
//         //     chrome.scripting.executeScript({
//         //         target: { tabId: activeTab.id },
//         //         function: (targetClass, ratio) => {
//         //             const elements = document.getElementsByClassName(targetClass);
//         //             console.log(elements);
//         //             Array.from(elements).forEach((element) => {
//         //                 const haveWantElements = element.querySelector(".community_result");
//         //                 const have = haveWantElements[0];
//         //                 const want = haveWantElements[1];
//         //
//         //                 if (have/want < ratio) {
//         //                     element.remove();
//         //                 }
//         //             });
//         //         },
//         //         args: [targetClass, ratio],
//         //     });
//         // });
//
//         // Optional: Send response back to content script
//         // if (sendResponse) {
//         //     sendResponse({ result: "Filtered by ratio" });
//         // }
//     }
// });