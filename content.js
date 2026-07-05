let autoTranslate = false;
let lastSeenText = "";
let observer = null;

init();

async function init() {
  if (window.__yccInitialized) return;
  window.__yccInitialized = true;

  const stored = await chrome.storage.local.get(["autoTranslate"]);
  autoTranslate = Boolean(stored.autoTranslate);

  injectStyles();
  injectCcButton();
  ensureVideoOverlay();
  startCaptionObserver();
  watchPlayerMount();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "AUTO_TRANSLATE_CHANGED") {
      autoTranslate = Boolean(message.enabled);
      updateCcButtonState();
      updateInjectedButtonLabel();
      setOverlayVisible(autoTranslate);
      if (!autoTranslate) {
        updateVideoOverlay(["", ""]);
      }
    }
  });
}

function injectStyles() {
  if (document.getElementById("ycc-styles")) return;

  const style = document.createElement("style");
  style.id = "ycc-styles";
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
    #ycc-video-overlay {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 72;
      max-width: 88%;
      width: max-content;
      pointer-events: none;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    #ycc-video-overlay.ycc-hidden {
      display: none;
    }
    #ycc-video-overlay .ycc-overlay-line {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      justify-content: flex-start;
      align-items: flex-start;
      margin: 0;
      padding: 10px 14px;
      border-radius: 4px;
      background: rgba(8, 8, 8, 0.82);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
      max-width: 100%;
      overflow: hidden;
    }
    #ycc-video-overlay .ycc-overlay-line:empty {
      display: none;
    }
    #ycc-video-overlay .ycc-overlay-line.dim {
      opacity: 0.9;
    }
    .ycc-ruby-col {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      flex: 0 0 auto;
      min-width: 1.4em;
      padding-right: 0.1em;
    }
    .ycc-ruby-han {
      font: 600 20px/1.2 "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    }
    .ycc-ruby-py {
      margin-top: 2px;
      font: 400 12px/1.1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #f0c674;
      min-height: 12px;
    }
    .ycc-ruby-py.empty {
      visibility: hidden;
    }
  `;
  document.head.appendChild(style);
}

function watchPlayerMount() {
  const attach = () => {
    ensureVideoOverlay();
    setOverlayVisible(autoTranslate);
  };

  const bodyObserver = new MutationObserver(attach);
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  attach();
}

function ensureVideoOverlay() {
  const player = document.getElementById("movie_player");
  if (!player) return null;

  let overlay = document.getElementById("ycc-video-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "ycc-video-overlay";
    overlay.className = "ycc-hidden";
    overlay.innerHTML = `
      <p class="ycc-overlay-line dim" data-line="1"></p>
      <p class="ycc-overlay-line" data-line="2"></p>
    `;
    player.appendChild(overlay);
  }

  return overlay;
}

function setOverlayVisible(visible) {
  const overlay = ensureVideoOverlay();
  if (!overlay) return;
  overlay.classList.toggle("ycc-hidden", !visible);
}

function updateVideoOverlay(lines) {
  const overlay = ensureVideoOverlay();
  if (!overlay || !autoTranslate) return;

  const [l1, l2] = normalizeOverlayLines(lines);
  const line1El = overlay.querySelector('[data-line="1"]');
  const line2El = overlay.querySelector('[data-line="2"]');
  if (!line1El || !line2El) return;

  renderOverlayRow(line1El, l1);
  renderOverlayRow(line2El, l2);
  setOverlayVisible(Boolean(l1 || l2));
}

function renderOverlayRow(el, text) {
  el.replaceChildren();
  if (!text) return;

  for (const char of splitGraphemes(text)) {
    const col = document.createElement("span");
    col.className = "ycc-ruby-col";

    const han = document.createElement("span");
    han.className = "ycc-ruby-han";
    han.textContent = char;

    const py = document.createElement("span");
    py.className = "ycc-ruby-py";
    const pyText = charToPinyin(char);
    py.textContent = pyText;
    if (!pyText) {
      py.classList.add("empty");
    }

    col.append(han, py);
    el.appendChild(col);
  }
}

function splitGraphemes(text) {
  if (!text) return [];
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].map(
      (part) => part.segment
    );
  }
  return [...text];
}

function isHanChar(char) {
  return /[\u3400-\u9fff]/.test(char);
}

function charToPinyin(char) {
  if (!char?.trim()) return "";
  if (!isHanChar(char)) return "";
  if (typeof pinyinPro === "undefined" || typeof pinyinPro.pinyin !== "function") {
    return "";
  }
  return pinyinPro.pinyin(char, { toneType: "symbol" });
}

function normalizeOverlayLines(lines) {
  const l1 = lines?.[0]?.trim() ?? "";
  const l2 = lines?.[1]?.trim() ?? "";
  return [l1, l2];
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
        updateVideoOverlay(["", ""]);
      }
    }
    return;
  }

  if (text === lastSeenText) return;
  lastSeenText = text;

  if (!autoTranslate) return;
  emitCaptionSync(twoLines, text);
  updateVideoOverlay(twoLines);
}

function emitCaptionSync(lines, text) {
  chrome.runtime.sendMessage({
    type: "CAPTION_SYNC",
    payload: { lines, text, timestamp: Date.now() },
  });
}

function injectCcButton() {
  if (document.getElementById("ycc-translate-btn")) return;

  const wrap = document.createElement("div");
  wrap.id = "ycc-translate-wrap";

  const btn = document.createElement("button");
  btn.id = "ycc-translate-btn";
  btn.type = "button";
  btn.title = "Sync captions to side panel + Pinyin overlay";
  updateInjectedButtonLabel(btn);

  btn.addEventListener("click", async () => {
    autoTranslate = !autoTranslate;
    await chrome.storage.local.set({ autoTranslate });
    chrome.runtime.sendMessage({ type: "SET_AUTO_TRANSLATE", enabled: autoTranslate });
    updateCcButtonState();
    updateInjectedButtonLabel(btn);
    setOverlayVisible(autoTranslate);

    if (autoTranslate) {
      const segments = readCaptionLines();
      const twoLines = toTwoLines(segments);
      const text = segments.join("\n");
      if (text) {
        emitCaptionSync(twoLines, text);
        updateVideoOverlay(twoLines);
      }
    } else {
      updateVideoOverlay(["", ""]);
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
