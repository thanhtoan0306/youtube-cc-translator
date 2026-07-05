chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTION_SYNC") {
    const lines = message.payload?.lines ?? ["", ""];
    const entry = {
      originalLines: lines,
      timestamp: message.payload?.timestamp ?? Date.now(),
    };
    chrome.storage.local.set({ lastCaption: entry }).catch(() => {});
    chrome.runtime.sendMessage({ type: "CAPTION_SYNC", payload: message.payload }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "GET_STATE") {
    chrome.storage.local.get(["autoTranslate", "lastCaption"]).then((data) => {
      sendResponse({
        autoTranslate: Boolean(data.autoTranslate),
        lastCaption: data.lastCaption ?? null,
      });
    });
    return true;
  }

  if (message.type === "SET_AUTO_TRANSLATE") {
    const enabled = Boolean(message.enabled);
    chrome.storage.local.set({ autoTranslate: enabled }).then(() => {
      if (!enabled) {
        chrome.storage.local.remove("lastCaption");
      }
      broadcastToTabs({ type: "AUTO_TRANSLATE_CHANGED", enabled });
      chrome.runtime
        .sendMessage({ type: "AUTO_TRANSLATE_CHANGED", enabled })
        .catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }
});

function broadcastToTabs(message) {
  chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  });
}
