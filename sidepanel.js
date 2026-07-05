class DualLineCaption {
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

function normalizeTwoLines(lines) {
  const l1 = lines?.[0]?.trim() ?? "";
  const l2 = lines?.[1]?.trim() ?? "";
  if (l1 && l2) return [l1, l2];
  if (l2) return ["", l2];
  if (l1) return ["", l1];
  return ["", ""];
}

const toggleBtn = document.getElementById("toggleBtn");
const toggleLabel = document.getElementById("toggleLabel");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const original = new DualLineCaption(document.querySelector('[data-caption="original"]'));

let ccSync = false;

init();

async function init() {
  const response = await sendMessage({ type: "GET_STATE" });
  ccSync = Boolean(response?.autoTranslate);
  renderToggle();

  if (response?.lastCaption?.originalLines) {
    applyOriginal(response.lastCaption.originalLines);
  }

  toggleBtn.addEventListener("click", onToggle);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CAPTION_SYNC") {
      applyOriginal(message.payload?.lines ?? message.payload?.text);
    }
    if (message.type === "AUTO_TRANSLATE_CHANGED") {
      ccSync = Boolean(message.enabled);
      renderToggle();
      if (!ccSync) {
        original.setLines(["", ""]);
      }
    }
  });
}

function applyOriginal(linesOrText) {
  if (Array.isArray(linesOrText)) {
    original.setLines(linesOrText);
    return;
  }
  if (typeof linesOrText === "string" && linesOrText.includes("\n")) {
    original.setLines(linesOrText.split("\n"));
    return;
  }
  original.setLines(["", linesOrText || ""]);
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
