const ROLL_MS = 420;

class RollingCaption {
  constructor(viewportEl) {
    this.viewport = viewportEl;
    this.track = viewportEl.querySelector(".caption-track");
    this.slot1 = viewportEl.querySelector('[data-slot="1"]');
    this.slot2 = viewportEl.querySelector('[data-slot="2"]');
    this.line1 = "";
    this.line2 = "";
    this.rolling = false;
  }

  update(lines) {
    const next = (lines ?? []).map((line) => line.trim()).filter(Boolean);
    if (!next.length) return;

    if (next.length >= 2) {
      this.setDirect(next[0], next[1]);
      return;
    }

    const incoming = next[0];
    if (incoming === this.line2) return;

    if (!this.line2) {
      this.setLine2(incoming);
      return;
    }

    if (incoming !== this.line2) {
      this.rollUp(incoming);
    }
  }

  setDirect(line1, line2) {
    if (line1 === this.line1 && line2 === this.line2) return;
    this.line1 = line1;
    this.line2 = line2;
    this.render();
  }

  setLine2(text) {
    this.line2 = text;
    this.slot2.textContent = text;
    this.slot2.classList.add("active");
    this.viewport.classList.remove("muted");
  }

  async rollUp(newLine2) {
    if (this.rolling) return;
    this.rolling = true;

    this.slot1.classList.add("fade-out");
    this.track.classList.add("shift");

    await waitForTransition(this.track, ROLL_MS);

    this.track.classList.remove("shift");
    this.slot1.classList.remove("fade-out");

    this.line1 = this.line2;
    this.line2 = newLine2;
    this.render();
    this.slot1.classList.add("fade-in");

    await waitForTransition(this.slot1, 280);
    this.slot1.classList.remove("fade-in");
    this.rolling = false;
  }

  render() {
    this.slot1.textContent = this.line1;
    this.slot2.textContent = this.line2;
    this.slot1.classList.toggle("filled", Boolean(this.line1));
    this.slot2.classList.toggle("active", Boolean(this.line2));
    this.viewport.classList.remove("muted");
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

init();

async function init() {
  const response = await sendMessage({ type: "GET_STATE" });
  autoTranslate = Boolean(response?.autoTranslate);
  renderToggle();

  if (response?.lastCaption) {
    showCaption(response.lastCaption);
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

function showCaption(entry) {
  const caption = normalizeCaption(entry);
  if (!caption.original.length) return;

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
