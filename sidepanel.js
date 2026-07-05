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

class LiveLineCaption {
  constructor(viewportEl) {
    this.viewport = viewportEl;
    this.line1El = viewportEl.querySelector('[data-line="1"]');
    this.line2El = viewportEl.querySelector('[data-line="2"]');
    this.line1 = "";
    this.line2 = "";
  }

  setLines(lines) {
    const [l1, l2] = normalizeTwoLines(lines);
    if (l1 === this.line1 && l2 === this.line2) return;

    this.line1 = l1;
    this.line2 = l2;
    this.line1El.textContent = l1;
    this.line2El.textContent = l2;

    this.line1El.classList.toggle("filled", Boolean(l1));
    this.line2El.classList.toggle("active", Boolean(l2));
    this.viewport.classList.toggle("muted", !l1 && !l2);
    this.viewport.classList.toggle("empty", !l1 && !l2);
  }
}

class RubyLineCaption {
  constructor(viewportEl) {
    this.viewport = viewportEl;
    this.line1El = viewportEl.querySelector('[data-line="1"]');
    this.line2El = viewportEl.querySelector('[data-line="2"]');
    this.line1 = "";
    this.line2 = "";
  }

  setLines(lines) {
    const [l1, l2] = normalizeTwoLines(lines);
    if (l1 === this.line1 && l2 === this.line2) return;

    this.line1 = l1;
    this.line2 = l2;
    this.renderRow(this.line1El, l1);
    this.renderRow(this.line2El, l2);

    this.line1El.classList.toggle("filled", Boolean(l1));
    this.line2El.classList.toggle("active", Boolean(l2));
    this.viewport.classList.toggle("empty", !l1 && !l2);
  }

  renderRow(el, text) {
    el.replaceChildren();
    if (!text) return;

    for (const char of splitGraphemes(text)) {
      const col = document.createElement("span");
      col.className = "ruby-col";

      const han = document.createElement("span");
      han.className = "ruby-han";
      han.textContent = char;

      const py = document.createElement("span");
      py.className = "ruby-py";
      const pyText = charToPinyin(char);
      py.textContent = pyText;
      if (!pyText) {
        py.classList.add("empty");
      }

      col.append(han, py);
      el.appendChild(col);
    }
  }
}

function normalizeTwoLines(lines) {
  const l1 = lines?.[0]?.trim() ?? "";
  const l2 = lines?.[1]?.trim() ?? "";
  return [l1, l2];
}

function resolveLines(linesOrText) {
  if (Array.isArray(linesOrText)) {
    return normalizeTwoLines(linesOrText);
  }
  if (typeof linesOrText === "string" && linesOrText.includes("\n")) {
    return normalizeTwoLines(linesOrText.split("\n"));
  }
  return normalizeTwoLines([linesOrText || "", ""]);
}

const toggleBtn = document.getElementById("toggleBtn");
const toggleLabel = document.getElementById("toggleLabel");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const live = new LiveLineCaption(document.querySelector('[data-caption="live"]'));
const pinyin = new RubyLineCaption(document.querySelector('[data-caption="pinyin"]'));

let ccSync = false;

init();

async function init() {
  const response = await sendMessage({ type: "GET_STATE" });
  ccSync = Boolean(response?.autoTranslate);
  renderToggle();

  if (response?.lastCaption?.originalLines) {
    applyCaption(response.lastCaption.originalLines);
  }

  toggleBtn.addEventListener("click", onToggle);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CAPTION_SYNC") {
      applyCaption(message.payload?.lines ?? message.payload?.text);
    }
    if (message.type === "AUTO_TRANSLATE_CHANGED") {
      ccSync = Boolean(message.enabled);
      renderToggle();
      if (!ccSync) {
        live.setLines(["", ""]);
        pinyin.setLines(["", ""]);
      }
    }
  });
}

function applyCaption(linesOrText) {
  const lines = resolveLines(linesOrText);
  live.setLines(lines);
  pinyin.setLines(lines);
}

async function onToggle() {
  ccSync = !ccSync;
  renderToggle();
  await sendMessage({ type: "SET_AUTO_TRANSLATE", enabled: ccSync });
}

function renderToggle() {
  toggleBtn.setAttribute("aria-pressed", String(ccSync));
  toggleLabel.textContent = ccSync ? "CC Sync On" : "Enable CC Sync";
  statusDot.classList.toggle("active", ccSync);
  statusText.textContent = ccSync ? "Synced with YouTube CC…" : "CC sync is off";
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}
