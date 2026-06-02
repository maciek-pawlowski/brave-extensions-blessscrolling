# bleSSScrolling

Local Brave/Chromium extension that hides Shorts and Reels that encourage doomscrolling.

bleSSScrolling is a Manifest V3 browser extension for people who want to reduce short-form video noise without sending their browsing history, titles, thumbnails, or watch data to any external service. It works locally in the browser and filters YouTube Shorts, Facebook Reels, and Instagram Reels with configurable keyword and creator rules.

## What It Does

- Hides YouTube Shorts from the YouTube home page completely.
- Blocks YouTube Shorts and Facebook Reels only when they match your local block rules or built-in doomscrolling friction screens.
- Hides Facebook Reels from normal Facebook feeds and lists completely.
- Blocks standard Facebook feed videos with a local overlay and stops playback.
- Blocks direct Facebook Reel pages with a friction screen before the next reel.
- Adds a simple math challenge every 5 videos after you choose to continue doomscrolling.
- Supports Instagram Reels as a best-effort web filter.
- Lets you block creators manually from the extension options or from supported blocking overlays.
- Keeps all rules and filtering local in `chrome.storage.local`.

The extension does not control YouTube, Facebook, or Instagram recommendation algorithms directly. It only changes what is visible in your browser after the platform loads the page.

## Installation In Brave Or Chromium

1. Open the latest GitHub Release.
2. Download `bleSSScrolling-v0.2.6.zip`.
3. Unzip the downloaded file.
4. Open `brave://extensions` in Brave, or `chrome://extensions` in Chrome/Chromium.
5. Turn on `Developer mode`.
6. Click `Load unpacked`.
7. Select the unzipped `bleSSScrolling` folder.

After loading the extension, pin it in the browser toolbar and open the popup or `Extension options` to edit your rules.

## Configuration

The extension uses a local blocklist-only configuration:

- `blockedCreators` - creators/channels/profiles that should always be hidden.
- `blockedKeywords` - keywords that block videos, for example prank, funny, drama, crashes, or memes.
- `overlayMode` - when enabled, blocked direct Shorts/Reels get a blocking screen with actions.

There is no whitelist or allowed-creators feature. Content without a blocked creator or blocked keyword is not hidden by keyword rules, though platform-level friction screens can still appear on Shorts/Reels pages.

## Blocking Creators Manually

1. Open the extension popup.
2. Click `Ustawienia reguł`.
3. Add the channel/profile name or handle to `Zablokowani twórcy`.
4. Save changes.
5. Refresh YouTube/Facebook/Instagram.

## Privacy

bleSSScrolling does not use a backend, cloud sync, analytics, tracking pixels, or external APIs. It reads page text from the current tab only to decide whether to hide or show a short video element. Your rules stay in local browser storage.

## Limitations

Short-form video platforms frequently change their web markup. YouTube filtering is the most stable. Facebook and Instagram filtering is best-effort and may require updates when Meta changes the DOM.

This extension should be used together with platform-native controls such as `Not interested`, `Don't recommend channel`, `Show less`, and watch-history cleanup. Those signals train the platform account over time; this extension handles local visibility immediately.

## Development

Run the basic checks:

```bash
npm test
npm run validate
node --check src/content/content.js
```

Project structure:

```text
manifest.json
src/content/      content script and styles
src/options/      extension options page
src/popup/        toolbar popup
src/shared/       default config and matching logic
tests/            lightweight matcher tests
```
