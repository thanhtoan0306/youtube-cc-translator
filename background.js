const CACHE_MAX = 600;
const TRANSLATE_DEBOUNCE_MS = 450;
const translationCache = new Map();
let translateDebounceTimer = null;
let pendingTranslate = null;
let translateSeq = 0;

const TARGET_LANGS = {
  en: "en",
  vi: "vi",
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTION_SYNC") {
    handleCaptionSync(message.payload, sender.tab?.id);
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
        clearTimeout(translateDebounceTimer);
        pendingTranslate = null;
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

function handleCaptionSync(payload, tabId) {
  const lines = normalizeLines(payload?.lines, payload?.text);
  const entry = {
    originalLines: lines,
    timestamp: payload?.timestamp ?? Date.now(),
  };

  chrome.storage.local.set({ lastCaption: entry }).catch(() => {});
  chrome.runtime.sendMessage({ type: "CAPTION_SYNC", payload }).catch(() => {});

  pendingTranslate = { lines, tabId };
  clearTimeout(translateDebounceTimer);
  translateDebounceTimer = setTimeout(() => {
    if (pendingTranslate) {
      translateCaptionLines(pendingTranslate.lines, pendingTranslate.tabId);
      pendingTranslate = null;
    }
  }, TRANSLATE_DEBOUNCE_MS);
}

async function translateCaptionLines(lines, tabId) {
  const settings = await chrome.storage.local.get(["autoTranslate"]);
  if (!settings.autoTranslate) return;

  const [l1, l2] = lines;
  if (!l1 && !l2) return;

  const seq = ++translateSeq;

  const [en1, en2, vi1, vi2] = await Promise.all([
    l1 ? translateText(l1, TARGET_LANGS.en) : Promise.resolve(""),
    l2 ? translateText(l2, TARGET_LANGS.en) : Promise.resolve(""),
    l1 ? translateText(l1, TARGET_LANGS.vi) : Promise.resolve(""),
    l2 ? translateText(l2, TARGET_LANGS.vi) : Promise.resolve(""),
  ]);

  if (seq !== translateSeq) return;

  const entry = {
    originalLines: lines,
    enLines: [en1, en2],
    viLines: [vi1, vi2],
    timestamp: Date.now(),
  };

  await chrome.storage.local.set({ lastCaption: entry });
  chrome.runtime.sendMessage({ type: "CAPTION_TRANSLATED", payload: entry }).catch(() => {});

  const targetTabId =
    tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (targetTabId) {
    chrome.tabs
      .sendMessage(targetTabId, { type: "CAPTION_TRANSLATED", payload: entry })
      .catch(() => {});
  }
}

function normalizeLines(lines, text) {
  if (Array.isArray(lines)) {
    return [lines[0]?.trim() ?? "", lines[1]?.trim() ?? ""];
  }
  if (typeof text === "string" && text.includes("\n")) {
    const parts = text.split("\n");
    return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? ""];
  }
  if (typeof text === "string" && text.trim()) {
    return [text.trim(), ""];
  }
  return ["", ""];
}

async function translateText(text, targetLang) {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const key = `${targetLang}:${trimmed}`;
  if (translationCache.has(key)) {
    return translationCache.get(key);
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", trimmed);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Translation failed (${response.status})`);
  }

  const data = await response.json();
  const translated = (data[0] ?? [])
    .map((part) => part?.[0])
    .filter(Boolean)
    .join("");

  if (!translated) {
    return trimmed;
  }

  translationCache.set(key, translated);
  if (translationCache.size > CACHE_MAX) {
    const oldest = translationCache.keys().next().value;
    translationCache.delete(oldest);
  }

  return translated;
}

function broadcastToTabs(message) {
  chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  });
}
