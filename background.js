const CACHE_MAX = 600;
const translationCache = new Map();
let updateSeq = 0;

const TARGET_LANGS = {
  zh: "zh-CN",
  en: "en",
  vi: "vi",
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTION_UPDATE") {
    handleCaptionUpdate(message.payload, sender.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "TRANSLATE_REQUEST") {
    const lang = TARGET_LANGS[message.lang] ?? message.lang ?? TARGET_LANGS.zh;
    translateText(message.text, lang)
      .then((translated) => sendResponse({ ok: true, translated }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
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

async function handleCaptionUpdate(payload, tabId) {
  const lines = normalizeLines(payload);
  if (!lines.length) return;

  const settings = await chrome.storage.local.get(["autoTranslate", "lastCaption"]);
  if (!settings.autoTranslate) return;

  const seq = ++updateSeq;
  const prev = settings.lastCaption ?? {};

  const [translatedZhLines, translatedEnLines, translatedViLines] = await Promise.all([
    translateLinesIncremental(prev.originalLines, lines, prev.translatedZhLines, TARGET_LANGS.zh),
    translateLinesIncremental(prev.originalLines, lines, prev.translatedEnLines, TARGET_LANGS.en),
    translateLinesIncremental(prev.originalLines, lines, prev.translatedViLines, TARGET_LANGS.vi),
  ]);

  if (seq !== updateSeq) return;

  const entry = {
    originalLines: lines,
    translatedZhLines,
    translatedEnLines,
    translatedViLines,
    timestamp: payload.timestamp ?? Date.now(),
    tabId,
  };

  await chrome.storage.local.set({ lastCaption: entry });
  chrome.runtime.sendMessage({ type: "CAPTION_TRANSLATED", payload: entry }).catch(() => {});
}

function normalizeLines(payload) {
  if (Array.isArray(payload?.lines)) {
    return payload.lines.map((line) => line.trim()).filter(Boolean);
  }
  if (payload?.original?.trim()) {
    return payload.original.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  return [];
}

async function translateLinesIncremental(prevLines, newLines, prevTranslated, targetLang) {
  const previous = prevLines ?? [];
  const translated = prevTranslated ?? [];
  const result = [];

  for (let i = 0; i < newLines.length; i++) {
    result.push(
      await translateLineIncremental(previous[i] ?? "", newLines[i], translated[i] ?? "", targetLang)
    );
  }

  return result;
}

async function translateLineIncremental(prevLine, newLine, prevTranslated, targetLang) {
  if (!newLine) return prevTranslated;

  if (newLine === prevLine) {
    if (prevTranslated) return prevTranslated;
    return translateText(newLine, targetLang);
  }

  if (prevLine && newLine.startsWith(prevLine)) {
    const delta = newLine.slice(prevLine.length);
    if (!delta) return prevTranslated;

    const translatedDelta = await translateText(delta, targetLang);
    return (prevTranslated || "") + translatedDelta;
  }

  return translateText(newLine, targetLang);
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
    throw new Error("Empty translation result");
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
