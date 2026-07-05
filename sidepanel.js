const ROLL_MS = 420;

function isGrowth(previous, next) {
  return Boolean(previous) && next.startsWith(previous) && next.length > previous.length;
}

function appendText(el, previous, next) {
  const delta = next.slice(previous.length);
  if (!delta) return;
  el.append(document.createTextNode(delta));
}

class RollingCaption {
  constructor(viewportEl) {
    this.viewport = viewportEl;
    this.slot1 = viewportEl.querySelector('[data-slot="1"]');
    this.slot2 = viewportEl.querySelector('[data-slot="2"]');
    this.line1 = "";
    this.line2 = "";
    this.rolling = false;
  }

  update(lines) {
    if (this.rolling) return;

    const next = (lines ?? []).map((line) => line.trim()).filter(Boolean);
    if (!next.length) return;

    if (next.length >= 2) {
      this.applyTwoLines(next[0], next[1]);
      return;
    }

    const incoming = next[0];
    if (incoming === this.line2) return;

    if (!this.line2) {
      this.setSlot2(incoming);
      return;
    }

    if (isGrowth(this.line2, incoming)) {
      this.growSlot2(incoming);
      return;
    }

    this.rollUp(incoming);
  }

  applyTwoLines(line1, line2) {
    if (line1 === this.line2 && line2 !== this.line2) {
      this.setSlot1(line1);
      this.setSlot2(line2);
      return;
    }

    if (line1 !== this.line1) {
      if (isGrowth(this.line1, line1)) {
        this.growSlot1(line1);
      } else {
        this.setSlot1(line1);
      }
    }

    if (line2 !== this.line2) {
      if (isGrowth(this.line2, line2)) {
        this.growSlot2(line2);
      } else {
        this.setSlot2(line2);
      }
    }
  }

  setSlot1(text) {
    if (text === this.line1) return;
    this.line1 = text;
    this.slot1.textContent = text;
    this.slot1.classList.toggle("filled", Boolean(text));
    this.viewport.classList.remove("muted");
  }

  growSlot1(text) {
    if (text === this.line1) return;
    appendText(this.slot1, this.line1, text);
    this.line1 = text;
    this.slot1.classList.add("filled");
    this.viewport.classList.remove("muted");
  }

  setSlot2(text) {
    if (text === this.line2) return;
    this.line2 = text;
    this.slot2.textContent = text;
    this.slot2.classList.toggle("active", Boolean(text));
    this.viewport.classList.remove("muted");
  }

  growSlot2(text) {
    if (text === this.line2) return;
    appendText(this.slot2, this.line2, text);
    this.line2 = text;
    this.slot2.classList.add("active");
    this.viewport.classList.remove("muted");
  }

  async rollUp(newLine2) {
    if (this.rolling || !this.line2 || newLine2 === this.line2) return;
    this.rolling = true;

    this.slot1.classList.add("fade-out");
    this.slot2.classList.add("slide-up");

    await waitForTransition(this.slot2, ROLL_MS);

    this.slot1.classList.remove("fade-out");
    this.slot2.classList.remove("slide-up");

    const promoted = this.line2;
    this.line1 = promoted;
    this.line2 = newLine2;

    this.slot1.textContent = promoted;
    this.slot2.textContent = newLine2;
    this.slot1.classList.add("filled");
    this.slot2.classList.add("active");

    this.slot1.classList.add("fade-in");
    await waitForTransition(this.slot1, 280);
    this.slot1.classList.remove("fade-in");

    this.rolling = false;
  }
}

function waitForTransition(el, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === el) finish();
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(finish, fallbackMs + 40);
  });
}

const toggleBtn = document.getElementById("toggleBtn");
const toggleLabel = document.getElementById("toggleLabel");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const rollers = {
  original: new RollingCaption(document.querySelector('[data-rolling="original"]')),
  zh: new RollingCaption(document.querySelector('[data-rolling="zh"]')),
  en: new RollingCaption(document.querySelector('[data-rolling="en"]')),
  vi: new RollingCaption(document.querySelector('[data-rolling="vi"]')),
};

let autoTranslate = false;
let lastPayloadKey = "";

init();

async function init() {
  const response = await sendMessage({ type: "GET_STATE" });
  autoTranslate = Boolean(response?.autoTranslate);
  renderToggle();

  if (response?.lastCaption) {
    showCaption(response.lastCaption, true);
  }

  toggleBtn.addEventListener("click", onToggle);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CAPTION_TRANSLATED") {
      showCaption(message.payload);
    }
    if (message.type === "AUTO_TRANSLATE_CHANGED") {
      autoTranslate = Boolean(message.enabled);
      renderToggle();
    }
  });
}

async function onToggle() {
  autoTranslate = !autoTranslate;
  renderToggle();
  await sendMessage({ type: "SET_AUTO_TRANSLATE", enabled: autoTranslate });
}

function renderToggle() {
  toggleBtn.setAttribute("aria-pressed", String(autoTranslate));
  toggleLabel.textContent = autoTranslate ? "Auto Translate On" : "Enable Auto Translate";
  statusDot.classList.toggle("active", autoTranslate);
  statusText.textContent = autoTranslate
    ? "Listening for YouTube captions…"
    : "Auto translate is off";
}

function normalizeCaption(entry) {
  if (entry.originalLines?.length) {
    return {
      original: entry.originalLines,
      zh: entry.translatedZhLines ?? [],
      en: entry.translatedEnLines ?? [],
      vi: entry.translatedViLines ?? [],
    };
  }

  const split = (value) =>
    value ? value.split("\n").map((line) => line.trim()).filter(Boolean) : [];

  return {
    original: split(entry.original),
    zh: split(entry.translatedZh || entry.translated),
    en: split(entry.translatedEn),
    vi: split(entry.translatedVi),
  };
}

function showCaption(entry, force = false) {
  const caption = normalizeCaption(entry);
  if (!caption.original.length) return;

  const payloadKey = JSON.stringify(caption);
  if (!force && payloadKey === lastPayloadKey) return;
  lastPayloadKey = payloadKey;

  rollers.original.update(caption.original);
  rollers.zh.update(caption.zh);
  rollers.en.update(caption.en);
  rollers.vi.update(caption.vi);
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}
