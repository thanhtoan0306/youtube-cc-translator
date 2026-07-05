let autoTranslate = false;
let lastSeenText = "";
let observer = null;

init();

async function init() {
  const stored = await chrome.storage.local.get(["autoTranslate"]);
  autoTranslate = Boolean(stored.autoTranslate);
  injectCcButton();
  startCaptionObserver();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "AUTO_TRANSLATE_CHANGED") {
      autoTranslate = Boolean(message.enabled);
      updateCcButtonState();
      updateInjectedButtonLabel();
    }
  });
}

function startCaptionObserver() {
  if (observer) observer.disconnect();

  observer = new MutationObserver(() => {
    handleCaptionChange();
  });

  const watch = () => {
    const container = document.querySelector(".ytp-caption-window-container");
    if (container) {
      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      return true;
    }
    return false;
  };

  if (!watch()) {
    const bodyObserver = new MutationObserver(() => {
      if (watch()) bodyObserver.disconnect();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function readCaptionLines() {
  const segments = document.querySelectorAll(".ytp-caption-segment");
  return Array.from(segments)
    .map((el) => el.textContent?.trim())
    .filter(Boolean);
}

function toTwoLines(segments) {
  const lines = (segments ?? []).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return ["", ""];
  return [lines[0] ?? "", lines[1] ?? ""];
}

function handleCaptionChange() {
  const segments = readCaptionLines();
  const twoLines = toTwoLines(segments);
  const text = segments.join("\n");

  if (!text) {
    if (lastSeenText) {
      lastSeenText = "";
      if (autoTranslate) {
        emitCaptionSync(["", ""], "");
      }
    }
    return;
  }

  if (text === lastSeenText) return;
  lastSeenText = text;

  if (!autoTranslate) return;
  emitCaptionSync(twoLines, text);
}

function emitCaptionSync(lines, text) {
  chrome.runtime.sendMessage({
    type: "CAPTION_SYNC",
    payload: { lines, text, timestamp: Date.now() },
  });
}

function injectCcButton() {
  if (document.getElementById("ycc-translate-btn")) return;

  const style = document.createElement("style");
  style.textContent = `
    #ycc-translate-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 8px;
      padding: 0 10px;
      height: 32px;
      border: none;
      border-radius: 18px;
      background: rgba(255,255,255,0.12);
      color: #fff;
      font: 500 12px/1 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    #ycc-translate-btn:hover {
      background: rgba(255,255,255,0.2);
    }
    #ycc-translate-btn.active {
      background: #e62117;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.15);
    }
    #ycc-translate-wrap {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.id = "ycc-translate-wrap";

  const btn = document.createElement("button");
  btn.id = "ycc-translate-btn";
  btn.type = "button";
  btn.title = "Sync captions to side panel";
  updateInjectedButtonLabel(btn);

  btn.addEventListener("click", async () => {
    autoTranslate = !autoTranslate;
    await chrome.storage.local.set({ autoTranslate });
    chrome.runtime.sendMessage({ type: "SET_AUTO_TRANSLATE", enabled: autoTranslate });
    updateCcButtonState();
    updateInjectedButtonLabel(btn);

    if (autoTranslate) {
      const segments = readCaptionLines();
      const twoLines = toTwoLines(segments);
      const text = segments.join("\n");
      if (text) {
        emitCaptionSync(twoLines, text);
      }
    }
  });

  wrap.appendChild(btn);
  placeButtonNearCc(wrap);
  updateCcButtonState();
}

function updateInjectedButtonLabel(btn = document.getElementById("ycc-translate-btn")) {
  if (!btn) return;
  btn.textContent = autoTranslate ? "CC Sync ON" : "CC Sync";
}

function updateCcButtonState() {
  const btn = document.getElementById("ycc-translate-btn");
  if (!btn) return;
  btn.classList.toggle("active", autoTranslate);
}

function placeButtonNearCc(wrap) {
  const tryPlace = () => {
    const rightControls = document.querySelector(".ytp-right-controls");
    if (rightControls && !wrap.isConnected) {
      rightControls.insertBefore(wrap, rightControls.firstChild);
      return true;
    }
    return false;
  };

  if (tryPlace()) return;

  const bodyObserver = new MutationObserver(() => {
    if (tryPlace()) bodyObserver.disconnect();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}
