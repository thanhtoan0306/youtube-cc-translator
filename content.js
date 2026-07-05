let autoTranslate = false;
let lastSeenText = "";
let lastTranslationTs = 0;
let overlayShowsLine2 = false;
let observer = null;

init();

async function init() {
  if (window.__yccInitialized) return;
  window.__yccInitialized = true;

  const stored = await chrome.storage.local.get(["autoTranslate", "lastCaption"]);
  autoTranslate = Boolean(stored.autoTranslate);

  injectStyles();
  injectCcButton();
  ensureVideoOverlay();
  startCaptionObserver();
  watchPlayerMount();

  if (autoTranslate && stored.lastCaption) {
    const lines = stored.lastCaption.originalLines;
    if (lines) {
      updateVideoOverlay(lines);
    }
    if (stored.lastCaption.enLines || stored.lastCaption.viLines) {
      applyOverlayTranslation(stored.lastCaption);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "AUTO_TRANSLATE_CHANGED") {
      autoTranslate = Boolean(message.enabled);
      updateCcButtonState();
      updateInjectedButtonLabel();
      setOverlayVisible(autoTranslate);
      if (!autoTranslate) {
        clearVideoOverlay();
      }
    }
    if (message.type === "CAPTION_TRANSLATED") {
      if (!autoTranslate) return;
      applyOverlayTranslation(message.payload);
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
      max-width: 90%;
      width: max-content;
      pointer-events: none;
    }
    #ycc-video-overlay.ycc-hidden {
      display: none;
    }
    .ycc-overlay-stack {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
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
    .ycc-overlay-block.en,
    .ycc-overlay-block.vi {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 4px;
      width: 100%;
    }
    .ycc-overlay-block.en .ycc-overlay-text,
    .ycc-overlay-block.vi .ycc-overlay-text {
      display: block;
      margin: 0;
      padding: 4px 10px;
      border-radius: 4px;
      background: rgba(8, 8, 8, 0.82);
      font: 600 8.5px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
      text-align: left;
      max-width: 100%;
      word-break: break-word;
      box-sizing: border-box;
      min-height: 0;
    }
    .ycc-overlay-block.en .ycc-overlay-text {
      color: #8ab4f8;
      box-shadow: inset 0 0 0 1px rgba(66, 133, 244, 0.28);
    }
    .ycc-overlay-block.vi .ycc-overlay-text {
      color: #81c995;
      font-family: "Segoe UI", "Noto Sans", sans-serif;
      box-shadow: inset 0 0 0 1px rgba(52, 168, 83, 0.28);
    }
    .ycc-overlay-text:not(.ycc-slot-hidden):empty {
      min-height: 18px;
      opacity: 0.28;
    }
    .ycc-overlay-text.dim {
      opacity: 0.9;
      font-size: 8px;
    }
    .ycc-overlay-text.dim:not(.ycc-slot-hidden):empty {
      min-height: 17px;
      opacity: 0.28;
    }
    .ycc-overlay-text.ycc-slot-hidden {
      display: none !important;
    }
    .ycc-overlay-block.pinyin:not(:has(.ycc-overlay-line:not(:empty))) {
      display: none;
    }
    #ycc-video-overlay.ycc-active .ycc-overlay-block.en,
    #ycc-video-overlay.ycc-active .ycc-overlay-block.vi {
      display: flex;
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
      <div class="ycc-overlay-stack">
        <div class="ycc-overlay-block pinyin" data-block="pinyin">
          <p class="ycc-overlay-line dim" data-pinyin-line="1"></p>
          <p class="ycc-overlay-line" data-pinyin-line="2"></p>
        </div>
        <div class="ycc-overlay-block en" data-block="en">
          <p class="ycc-overlay-text dim" data-en-line="1"></p>
          <p class="ycc-overlay-text" data-en-line="2"></p>
        </div>
        <div class="ycc-overlay-block vi" data-block="vi">
          <p class="ycc-overlay-text dim" data-vi-line="1"></p>
          <p class="ycc-overlay-text" data-vi-line="2"></p>
        </div>
      </div>
    `;
    player.appendChild(overlay);
  }

  return overlay;
}

function setOverlayVisible(visible) {
  const overlay = ensureVideoOverlay();
  if (!overlay) return;
  overlay.classList.toggle("ycc-hidden", !visible);
  overlay.classList.toggle("ycc-active", visible && autoTranslate);
}

function updateVideoOverlay(lines) {
  const overlay = ensureVideoOverlay();
  if (!overlay || !autoTranslate) return;

  const [l1, l2] = normalizeOverlayLines(lines);
  const line1El = overlay.querySelector('[data-pinyin-line="1"]');
  const line2El = overlay.querySelector('[data-pinyin-line="2"]');
  if (!line1El || !line2El) return;

  renderOverlayRow(line1El, l1);
  renderOverlayRow(line2El, l2);
  overlayShowsLine2 = Boolean(l2);
  syncOverlaySecondLine(overlay, overlayShowsLine2);
  if (!l1 && !l2) {
    updateOverlayTranslations(["", ""], ["", ""], Date.now());
    lastTranslationTs = 0;
  }
  refreshOverlayVisibility(overlay);
}

function applyOverlayTranslation(entry) {
  if (!entry) return;
  const ts = entry.timestamp ?? 0;
  if (ts && ts < lastTranslationTs) return;
  if (ts) lastTranslationTs = ts;
  updateOverlayTranslations(entry.enLines, entry.viLines, ts);
}

function updateOverlayTranslations(enLines, viLines, timestamp = 0) {
  const overlay = ensureVideoOverlay();
  if (!overlay || !autoTranslate) return;

  const [en1, en2] = normalizeOverlayLines(enLines);
  const [vi1, vi2] = normalizeOverlayLines(viLines);

  setOverlayTextLine(overlay, "en", 1, en1);
  setOverlayTextLine(overlay, "en", 2, en2);
  setOverlayTextLine(overlay, "vi", 1, vi1);
  setOverlayTextLine(overlay, "vi", 2, vi2);
  syncOverlaySecondLine(overlay, overlayShowsLine2 || Boolean(en2) || Boolean(vi2));
  refreshOverlayVisibility(overlay);
}

function syncOverlaySecondLine(overlay, showLine2) {
  for (const lang of ["en", "vi"]) {
    const line2 = overlay.querySelector(`[data-${lang}-line="2"]`);
    if (line2) {
      line2.classList.toggle("ycc-slot-hidden", !showLine2);
    }
  }
}

function setOverlayTextLine(overlay, lang, index, text) {
  const el = overlay.querySelector(`[data-${lang}-line="${index}"]`);
  if (el) {
    el.textContent = text;
  }
}

function refreshOverlayVisibility(overlay) {
  const hasPinyin = [...overlay.querySelectorAll("[data-pinyin-line]")].some(
    (el) => el.childElementCount > 0
  );
  const hasEn = [...overlay.querySelectorAll("[data-en-line]")].some((el) => el.textContent?.trim());
  const hasVi = [...overlay.querySelectorAll("[data-vi-line]")].some((el) => el.textContent?.trim());
  setOverlayVisible(hasPinyin || hasEn || hasVi);
}

function clearVideoOverlay() {
  lastTranslationTs = 0;
  overlayShowsLine2 = false;
  const overlay = ensureVideoOverlay();
  if (!overlay) return;

  const line1El = overlay.querySelector('[data-pinyin-line="1"]');
  const line2El = overlay.querySelector('[data-pinyin-line="2"]');
  if (line1El) renderOverlayRow(line1El, "");
  if (line2El) renderOverlayRow(line2El, "");
  setOverlayTextLine(overlay, "en", 1, "");
  setOverlayTextLine(overlay, "en", 2, "");
  setOverlayTextLine(overlay, "vi", 1, "");
  setOverlayTextLine(overlay, "vi", 2, "");
  syncOverlaySecondLine(overlay, false);
  setOverlayVisible(false);
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
        clearVideoOverlay();
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
  btn.title = "Sync captions to side panel + video overlay";
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
      clearVideoOverlay();
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
