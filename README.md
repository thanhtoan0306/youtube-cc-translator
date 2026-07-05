# YouTube CC → 简体中文

Chrome extension that watches YouTube closed captions (CC) and auto-translates them to **Simplified Chinese (zh-CN)**. Translations appear in the extension **side panel**, with a toggle button on the YouTube player controls.

## Features

- Reads live YouTube CC text from the player
- One-click **Auto Translate** in the side panel
- Extra **「翻译中文」** button injected next to YouTube player controls
- Shows original caption plus Simplified Chinese, English, and Vietnamese translations

## Install (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `youtube-cc-translator`
5. Open any YouTube video, turn on **CC/subtitles**
6. Click the extension icon to open the **side panel**
7. Press **开启自动翻译** (or the YouTube **翻译中文** button)

## Usage tips

- CC must be enabled on the video (YouTube subtitle button)
- Works on `youtube.com` watch pages
- Translation uses Google Translate (`zh-CN`); no API key required
- If translation stops, refresh the YouTube tab after reloading the extension

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension config (MV3 + side panel) |
| `content.js` | Watches YouTube captions, injects CC button |
| `background.js` | Translation service + message routing |
| `sidepanel.html/js/css` | Extension panel UI |

## Permissions

- `storage` — remember auto-translate toggle
- `sidePanel` — extension panel UI
- `tabs` — sync state across YouTube tabs
- `youtube.com` — read caption DOM
- `translate.googleapis.com` — translation requests
