(function initPsychShortsContentScript() {
  "use strict";

  var defaults = window.ShortMindDefaults;
  var matcher = window.ShortMindMatcher;
  var scanTimer = 0;
  var allowedOnce = new WeakMap();
  var allowedOnceKeys = [];
  var processedNodes = new WeakMap();
  var blockedVideos = new WeakMap();
  var pendingDoomPromptKeys = {
    facebook: "",
    youtube: ""
  };

  if (!defaults || !matcher) {
    return;
  }

  var config = defaults.mergeConfig();

  function storageGet(callback) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      callback(defaults.mergeConfig());
      return;
    }

    chrome.storage.local.get(defaults.STORAGE_KEY, function handleConfig(result) {
      callback(defaults.mergeConfig(result && result[defaults.STORAGE_KEY]));
    });
  }

  function storageSet(nextConfig, callback) {
    var payload = {};

    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      return;
    }

    payload[defaults.STORAGE_KEY] = defaults.mergeConfig(nextConfig);
    chrome.storage.local.set(payload, callback || function noop() {});
  }

  function addToList(listName, value) {
    var normalizedValue = String(value || "").trim();

    if (!normalizedValue) {
      return;
    }

    config[listName] = defaults.uniqueList((config[listName] || []).concat(normalizedValue));
    storageSet(config, function afterSave() {
      scheduleScan(50);
    });
  }

  function getPlatform() {
    var host = location.hostname;

    if (host.indexOf("youtube.com") !== -1) {
      return "youtube";
    }
    if (host.indexOf("facebook.com") !== -1 || host.indexOf("web.facebook.com") !== -1) {
      return "facebook";
    }
    if (host.indexOf("instagram.com") !== -1) {
      return "instagram";
    }

    return "unknown";
  }

  function closestAny(node, selectors) {
    for (var index = 0; index < selectors.length; index += 1) {
      var match = node.closest(selectors[index]);
      if (match) {
        return match;
      }
    }
    return null;
  }

  function climbToUsefulContainer(anchor) {
    var node = anchor;
    var steps = 0;

    while (node && node !== document.body && steps < 8) {
      if (node.tagName === "ARTICLE") {
        return node;
      }

      if (node.matches && node.matches('[role="article"], [aria-posinset], [data-pagelet], ytd-rich-item-renderer, ytd-video-renderer')) {
        return node;
      }

      if (node.tagName === "DIV") {
        var rect = node.getBoundingClientRect();
        var textLength = getNodeText(node).length;
        if (rect.width > 120 && rect.height > 80 && textLength > 12) {
          return node;
        }
      }

      node = node.parentElement;
      steps += 1;
    }

    return anchor.parentElement || anchor;
  }

  function isDocumentScaleContainer(node) {
    var rect;

    if (!node || node === document.body || node === document.documentElement) {
      return true;
    }

    if (node.matches && node.matches("ytd-app, ytd-browse, ytd-page-manager, ytd-rich-grid-renderer, ytd-two-column-browse-results-renderer, main, [role='main'], #content, #page-manager")) {
      return true;
    }

    rect = node.getBoundingClientRect();
    return rect.width > window.innerWidth * 0.72 && rect.height > window.innerHeight * 0.72;
  }

  function isShortsWatchPage() {
    return /^\/shorts(\/|$)/.test(location.pathname);
  }

  function isYouTubeHomePage() {
    return location.pathname === "/" || location.pathname === "";
  }

  function isYouTubeChannelShortsPage() {
    return /^\/@[^/?#]+\/shorts(\/|$)/.test(location.pathname);
  }

  function isYouTubeWatchPage() {
    return /^\/watch$/.test(location.pathname);
  }

  function isVisibleRect(rect) {
    return rect.width > 80 &&
      rect.height > 120 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
  }

  function isVerticalVideoRect(rect) {
    return isVisibleRect(rect) && rect.height >= rect.width * 1.12 && rect.height > 260;
  }

  function isPlayableVideoRect(rect) {
    return isVisibleRect(rect) && rect.width > 160 && rect.height > 120;
  }

  function isProbablyShortWatchContext() {
    if (isShortsWatchPage()) {
      return true;
    }

    if (!isYouTubeWatchPage()) {
      return false;
    }

    return Array.prototype.slice.call(document.querySelectorAll("video")).some(function hasVerticalVideo(video) {
      return isVerticalVideoRect(video.getBoundingClientRect());
    });
  }

  function isSequentialDoomContext(platform) {
    if (platform === "youtube") {
      return isShortsWatchPage() || isProbablyShortWatchContext();
    }

    if (platform === "facebook") {
      return isFacebookReelWatchPage();
    }

    return false;
  }

  function isFacebookReelWatchPage() {
    return /^\/reel\/|^\/watch\/reel\b/.test(location.pathname);
  }

  function hasFacebookReelLink(node) {
    if (!node) {
      return false;
    }

    if (node.matches && node.matches("a[href*='/reel/'], a[href*='/watch/reel/']")) {
      return true;
    }

    return !!(node.querySelector && node.querySelector("a[href*='/reel/'], a[href*='/watch/reel/']"));
  }

  function normalizeSignalText(value) {
    if (matcher && matcher.normalizeText) {
      return matcher.normalizeText(value);
    }

    return String(value || "").toLocaleLowerCase();
  }

  function hasMessengerSignalText(value) {
    var text = normalizeSignalText(value);

    return text.indexOf("messenger") !== -1 ||
      text.indexOf("chat") !== -1 ||
      text.indexOf("czat") !== -1 ||
      text.indexOf("conversation") !== -1 ||
      text.indexOf("rozmow") !== -1 ||
      text.indexOf("wiadom") !== -1 ||
      text.indexOf("/messages/") !== -1 ||
      text.indexOf("messenger.com") !== -1;
  }

  function elementHasMessengerSignal(element) {
    if (!element || !element.getAttribute) {
      return false;
    }

    return hasMessengerSignalText([
      element.getAttribute("aria-label"),
      element.getAttribute("data-pagelet"),
      element.getAttribute("data-testid"),
      element.getAttribute("id"),
      element.getAttribute("href"),
      element.getAttribute("placeholder"),
      element.getAttribute("title")
    ].join(" "));
  }

  function subtreeHasMessengerSignal(node) {
    var candidates;

    if (!node || !node.querySelectorAll) {
      return false;
    }

    candidates = Array.prototype.slice.call(node.querySelectorAll("[aria-label], [data-pagelet], [data-testid], [id], a[href], textarea, [role='textbox'], [contenteditable='true']")).slice(0, 80);

    return candidates.some(elementHasMessengerSignal);
  }

  function isFacebookMessagesPath() {
    return /^\/messages(\/|$)|^\/messenger(\/|$)/.test(location.pathname);
  }

  function isFacebookMessengerSurface(node) {
    var current = node;
    var dialog = null;
    var steps = 0;

    if (!node || isFacebookReelWatchPage()) {
      return false;
    }

    if (isFacebookMessagesPath()) {
      return true;
    }

    while (current && current !== document.body && steps < 10) {
      if (elementHasMessengerSignal(current)) {
        return true;
      }

      if (!dialog && current.matches && current.matches("[role='dialog'], [aria-modal='true']")) {
        dialog = current;
      }

      current = current.parentElement;
      steps += 1;
    }

    return !!(dialog && subtreeHasMessengerSignal(dialog));
  }

  function getYouTubeShortsCard(anchor) {
    var card = closestAny(anchor, [
      "ytd-reel-video-renderer",
      "ytd-shorts-video-renderer",
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-reel-item-renderer",
      "ytd-shorts-lockup-view-model",
      "ytm-shorts-lockup-view-model",
      "yt-lockup-view-model"
    ]);

    if (!card || isDocumentScaleContainer(card)) {
      return findVisualShortsCardFromAnchor(anchor);
    }

    return card;
  }

  function findVisualShortsCardFromAnchor(anchor) {
    var node = anchor;
    var best = null;
    var steps = 0;

    while (node && node !== document.body && steps < 10) {
      var rect = node.getBoundingClientRect();

      if (
        !isDocumentScaleContainer(node) &&
        rect.width >= 90 &&
        rect.width <= 720 &&
        rect.height >= 120 &&
        rect.height <= 1100
      ) {
        best = node;
      }

      node = node.parentElement;
      steps += 1;
    }

    return best;
  }

  function findActiveYouTubeShortsPlayer() {
    var videos;
    var activeVideo;
    var target;

    if (!isProbablyShortWatchContext()) {
      return null;
    }

    videos = Array.prototype.slice.call(document.querySelectorAll("video"))
      .filter(function keepVisibleVerticalVideo(video) {
        return isVerticalVideoRect(video.getBoundingClientRect());
      })
      .sort(function largestFirst(left, right) {
        var leftRect = left.getBoundingClientRect();
        var rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      });

    activeVideo = videos[0];
    if (!activeVideo) {
      return null;
    }

    target = closestAny(activeVideo, [
      "ytd-reel-video-renderer",
      "ytd-shorts-video-renderer",
      "ytd-reel-player-renderer",
      "ytd-shorts-player",
      "#movie_player",
      ".html5-video-player",
      ".html5-video-container"
    ]);

    if (!target || isDocumentScaleContainer(target)) {
      target = activeVideo.parentElement;
    }

    if (!target || isDocumentScaleContainer(target)) {
      return null;
    }

    target.dataset.psfYouTubeActivePlayer = "true";
    return target;
  }

  function getNodeText(node) {
    var readableNode = node;

    if (!node) {
      return "";
    }

    if (node.matches && node.matches(".psf-overlay")) {
      return "";
    }

    if (node.querySelector && node.querySelector(".psf-overlay")) {
      readableNode = node.cloneNode(true);
      Array.prototype.slice.call(readableNode.querySelectorAll(".psf-overlay")).forEach(function removeOverlay(overlay) {
        overlay.remove();
      });
    }

    return String((readableNode.innerText || readableNode.textContent) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  }

  function getVideosForNode(node) {
    var videos = [];

    if (!node) {
      return videos;
    }

    if (node.tagName === "VIDEO") {
      videos.push(node);
    }

    if (node.querySelectorAll) {
      videos = videos.concat(Array.prototype.slice.call(node.querySelectorAll("video")));
    }

    if (!videos.length && node.parentElement && node.parentElement.querySelectorAll) {
      videos = videos.concat(Array.prototype.slice.call(node.parentElement.querySelectorAll("video")).filter(function keepNearby(video) {
        var nodeRect = node.getBoundingClientRect();
        var videoRect = video.getBoundingClientRect();

        return isVisibleRect(videoRect) &&
          Math.abs((nodeRect.left + nodeRect.right) / 2 - (videoRect.left + videoRect.right) / 2) < Math.max(nodeRect.width, videoRect.width) &&
          Math.abs((nodeRect.top + nodeRect.bottom) / 2 - (videoRect.top + videoRect.bottom) / 2) < Math.max(nodeRect.height, videoRect.height);
      }));
    }

    return videos;
  }

  function blockPlayback(node) {
    getVideosForNode(node).forEach(function muteAndPause(video) {
      if (!blockedVideos.has(video)) {
        blockedVideos.set(video, {
          muted: video.muted,
          volume: video.volume,
          node: node
        });
      }

      video.muted = true;
      video.volume = 0;

      if (!video.paused) {
        video.pause();
      }
    });
  }

  function unblockPlayback(node) {
    getVideosForNode(node).forEach(function restoreVideo(video) {
      var previous = blockedVideos.get(video);

      if (!previous || previous.node !== node) {
        return;
      }

      video.muted = previous.muted;
      video.volume = previous.volume;
      blockedVideos.delete(video);
    });
  }

  function enforceBlockedPlayback(video) {
    if (!blockedVideos.has(video)) {
      return;
    }

    video.muted = true;
    video.volume = 0;

    if (!video.paused) {
      video.pause();
    }
  }

  function findReasonableVideoContainer(video) {
    var videoRect = video.getBoundingClientRect();
    var node = video.parentElement;
    var best = null;
    var steps = 0;

    while (node && node !== document.body && steps < 10) {
      var rect = node.getBoundingClientRect();

      if (
        isVisibleRect(rect) &&
        !isDocumentScaleContainer(node) &&
        rect.width >= videoRect.width * 0.75 &&
        rect.height >= videoRect.height * 0.75
      ) {
        best = node;
      }

      if (node.matches && node.matches("[role='article'], [role='dialog']")) {
        break;
      }

      node = node.parentElement;
      steps += 1;
    }

    return best || video.parentElement;
  }

  function isFacebookActiveReelNode(node) {
    return !!(node && node.dataset && node.dataset.psfFacebookActiveReel === "true");
  }

  function findActiveFacebookReelPlayer() {
    var videos;
    var activeVideo;
    var target;

    if (!isFacebookReelWatchPage()) {
      return null;
    }

    videos = Array.prototype.slice.call(document.querySelectorAll("video"))
      .filter(function keepVisibleVideo(video) {
        return isPlayableVideoRect(video.getBoundingClientRect());
      })
      .sort(function largestFirst(left, right) {
        var leftRect = left.getBoundingClientRect();
        var rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      });

    activeVideo = videos[0];
    if (!activeVideo) {
      return null;
    }

    target = findReasonableVideoContainer(activeVideo);
    if (!target || isDocumentScaleContainer(target)) {
      target = activeVideo.parentElement;
    }

    if (!target || target === document.body || target === document.documentElement) {
      return null;
    }

    target.dataset.psfFacebookActiveReel = "true";
    return target;
  }

  function findFacebookReelWatchContainer() {
    var target;

    if (!isFacebookReelWatchPage()) {
      return null;
    }

    target = document.querySelector("[role='dialog']") ||
      document.querySelector("[aria-modal='true']") ||
      document.querySelector("[role='main']") ||
      document.querySelector("main");

    if (!target || target === document.body || target === document.documentElement) {
      return null;
    }

    target.dataset.psfFacebookActiveReel = "true";
    return target;
  }

  function isFacebookChromeOrPreview(node) {
    var rect;
    var reelLinks;

    if (isFacebookActiveReelNode(node)) {
      return false;
    }

    if (!node || !node.getBoundingClientRect) {
      return true;
    }

    if (isFacebookMessengerSurface(node)) {
      return true;
    }

    if (node.closest && node.closest("[role='banner'], [role='navigation'], form[role='search']")) {
      return true;
    }

    rect = node.getBoundingClientRect();
    reelLinks = node.querySelectorAll ? node.querySelectorAll("a[href*='/reel/'], a[href*='/watch/reel/']") : [];

    if (!isVisibleRect(rect)) {
      return true;
    }

    if (reelLinks.length > 1 && rect.width > 520) {
      return true;
    }

    if (rect.width < 240 || rect.height < 180) {
      return true;
    }

    return rect.top < 130 && rect.width < 360;
  }

  function shouldUseFacebookCandidate(node) {
    return !!(node && !isFacebookMessengerSurface(node) && (isFacebookActiveReelNode(node) || isFacebookInlineReelsContainer(node) || (!isDocumentScaleContainer(node) && (isFacebookReelCard(node) || !isFacebookChromeOrPreview(node)))));
  }

  function isFacebookReelCard(node) {
    var rect;
    var hasReelSignal;
    var hasReelLink;

    if (!node || !node.getBoundingClientRect || isDocumentScaleContainer(node) || isFacebookMessengerSurface(node)) {
      return false;
    }

    if (node.closest && node.closest("[role='banner'], [role='navigation'], form[role='search']")) {
      return false;
    }

    hasReelLink = !!(node.matches && node.matches("a[href*='/reel/'], a[href*='/watch/reel/']"));
    hasReelSignal = hasReelLink;

    if (!hasReelSignal && node.querySelector) {
      hasReelLink = !!node.querySelector("a[href*='/reel/'], a[href*='/watch/reel/']");
      hasReelSignal = hasReelLink || !!node.querySelector("img, [style*='background-image']");
    }

    if (!hasReelSignal) {
      return false;
    }

    if (!hasReelLink && !isFacebookReelWatchPage()) {
      return false;
    }

    rect = node.getBoundingClientRect();

    if (!isVisibleRect(rect) ||
      rect.width < 120 ||
      rect.width > 420 ||
      rect.height < 180 ||
      rect.height > 760 ||
      rect.height < rect.width * 1.05) {
      return false;
    }

    return hasReelLink || rect.height >= rect.width * 1.35;
  }

  function isFacebookInlineReelsContainer(node) {
    var rect;
    var reelLinkCount;

    if (!node || !node.getBoundingClientRect || isFacebookReelWatchPage() || isFacebookActiveReelNode(node) || isDocumentScaleContainer(node) || isFacebookMessengerSurface(node)) {
      return false;
    }

    if (node.closest && node.closest("[role='banner'], [role='navigation'], form[role='search']")) {
      return false;
    }

    if (!hasFacebookReelLink(node)) {
      return false;
    }

    rect = node.getBoundingClientRect();
    if (!isVisibleRect(rect) || rect.width < 120 || rect.height < 120 || rect.height > Math.max(760, window.innerHeight * 0.85)) {
      return false;
    }

    if (isFacebookReelCard(node)) {
      return true;
    }

    reelLinkCount = node.querySelectorAll ? node.querySelectorAll("a[href*='/reel/'], a[href*='/watch/reel/']").length : 1;

    if (reelLinkCount > 1 && rect.height <= 760) {
      return true;
    }

    return !!(node.matches && node.matches("[role='article'], [aria-posinset], [data-pagelet]"));
  }

  function shouldHideFacebookInlineReels(node) {
    return isFacebookInlineReelsContainer(node);
  }

  function findFacebookInlineReelsContainer(seed) {
    var node = seed;
    var best = null;
    var steps = 0;

    while (node && node !== document.body && steps < 12) {
      if (isFacebookInlineReelsContainer(node)) {
        best = node;
      }

      if (best && node.matches && node.matches("[role='article'], [data-pagelet]")) {
        break;
      }

      node = node.parentElement;
      steps += 1;
    }

    return best;
  }

  function findFacebookReelCard(seed) {
    var node = seed;
    var best = null;
    var steps = 0;

    while (node && node !== document.body && steps < 12) {
      if (isFacebookReelCard(node)) {
        best = node;
      }

      if (node.matches && node.matches("[role='article'], [data-pagelet]")) {
        break;
      }

      node = node.parentElement;
      steps += 1;
    }

    return best;
  }

  function findFacebookReelCardFromMedia(media) {
    var node = media;
    var best = null;
    var steps = 0;

    while (node && node !== document.body && steps < 10) {
      if (isFacebookReelCard(node)) {
        best = node;
      }

      if (node.matches && node.matches("[role='article'], [data-pagelet]")) {
        break;
      }

      node = node.parentElement;
      steps += 1;
    }

    return best;
  }

  function getNodeFingerprint(node, video) {
    return matcher.normalizeText([
      location.href,
      video && video.title,
      video && video.creator,
      video && video.handle,
      video && video.hashtags,
      video && video.text,
      getNodeText(node).slice(0, 500)
    ].join(" ")).slice(0, 1000);
  }

  function getContentKey(platform, node, video) {
    if (platform === "facebook") {
      return matcher.normalizeText([
        "facebook",
        location.pathname,
        location.search,
        video && video.creator,
        video && video.handle,
        getFacebookVideoSource(node),
        getNodeText(node).slice(0, 700)
      ].join(" ")).slice(0, 1000);
    }

    if (platform === "youtube") {
      return matcher.normalizeText([
        "youtube",
        location.pathname,
        location.search,
        video && video.title,
        video && video.creator,
        video && video.handle,
        video && video.text,
        getYouTubeVideoSource(node),
        getNodeText(node).slice(0, 700)
      ].join(" ")).slice(0, 1000);
    }

    return getNodeFingerprint(node, video);
  }

  function getYouTubeVideoSource(node) {
    var video = node && (node.tagName === "VIDEO" ? node : node.querySelector && node.querySelector("video"));
    var shortsLink = node && pickAttribute(node, ["a[href*='/shorts/']"], "href");

    if (!video) {
      return shortsLink || "";
    }

    return [
      shortsLink,
      video.currentSrc,
      video.src,
      video.getAttribute("src"),
      video.duration || "",
      Math.round(video.videoWidth || 0),
      Math.round(video.videoHeight || 0)
    ].join(" ");
  }

  function getFacebookVideoSource(node) {
    var video = node && (node.tagName === "VIDEO" ? node : node.querySelector && node.querySelector("video"));

    if (!video) {
      return "";
    }

    return [
      video.currentSrc,
      video.src,
      video.getAttribute("src"),
      video.duration || "",
      Math.round(video.videoWidth || 0),
      Math.round(video.videoHeight || 0)
    ].join(" ");
  }

  function rememberAllowedOnceKey(key) {
    if (!key) {
      return;
    }

    allowedOnceKeys = allowedOnceKeys.filter(function keepDifferent(existingKey) {
      return existingKey !== key;
    });
    allowedOnceKeys.push(key);

    if (allowedOnceKeys.length > 40) {
      allowedOnceKeys.shift();
    }
  }

  function isAllowedOnceKey(key) {
    return !!key && allowedOnceKeys.indexOf(key) !== -1;
  }

  function clearFacebookFiltersForKey(key) {
    clearPlatformFiltersForKey("facebook", key);
  }

  function clearPlatformFiltersForKey(platform, key) {
    if (!key) {
      return;
    }

    Array.prototype.slice.call(document.querySelectorAll(".psf-filtered")).forEach(function clearMatchingNode(node) {
      var video = getExtractor(platform)(node);
      var nodeKey = getContentKey(platform, node, video);

      if (nodeKey === key) {
        clearFilter(node);
      }
    });
  }

  function pickFirstText(node, selectors) {
    for (var index = 0; index < selectors.length; index += 1) {
      var element = node.querySelector(selectors[index]);
      var text = element && getNodeText(element);

      if (text) {
        return text;
      }
    }

    return "";
  }

  function pickAttribute(node, selectors, attribute) {
    for (var index = 0; index < selectors.length; index += 1) {
      var element = node.querySelector(selectors[index]);
      var value = element && element.getAttribute(attribute);

      if (value) {
        return value;
      }
    }

    return "";
  }

  function parseCreatorFromHref(href) {
    var match = String(href || "").match(/\/(@[^/?#]+)/);
    return match ? match[1] : "";
  }

  function getYouTubeChannelPageCreator() {
    var pathMatch = location.pathname.match(/^\/(@[^/?#]+)/);
    var handle = pathMatch ? pathMatch[1] : "";
    var name = "";

    if (handle) {
      name = pickFirstText(document, [
        "#channel-header h1",
        "ytd-channel-name #text",
        "yt-dynamic-text-view-model h1",
        "h1"
      ]);
    }

    return {
      handle: handle,
      name: name
    };
  }

  function extractYouTube(node) {
    var pageTitle = String(document.title || "").replace(/\s+-\s+YouTube$/, "").trim();
    var canonicalHref = pickAttribute(document, ["link[rel='canonical']"], "href");
    var channelPageCreator = getYouTubeChannelPageCreator();
    var title = pickFirstText(node, [
      "#video-title",
      "h3",
      "yt-formatted-string#video-title",
      "yt-shorts-video-title-view-model",
      "ytd-reel-player-overlay-renderer",
      "ytd-watch-metadata h1",
      ".yt-core-attributed-string",
      "a[title]"
    ]);
    var titleAttribute = pickAttribute(node, ["a[title]"], "title");
    var creator = pickFirstText(node, [
      "ytd-channel-name a",
      "#channel-name a",
      "a.yt-simple-endpoint[href*='/@']",
      "a[href*='/@']"
    ]);
    var hrefCreator = parseCreatorFromHref(pickAttribute(node, ["a[href*='/@']"], "href"));
    var shortsHref = pickAttribute(node, ["a[href*='/shorts/']"], "href");

    if (node.dataset && node.dataset.psfYouTubeActivePlayer === "true") {
      title = title || pickFirstText(document, [
        "yt-shorts-video-title-view-model",
        "ytd-reel-player-overlay-renderer",
        "ytd-watch-metadata h1",
        "h1"
      ]);
      creator = creator || pickFirstText(document, [
        "ytd-reel-player-header-renderer a[href*='/@']",
        "ytd-watch-metadata ytd-channel-name a",
        "ytd-channel-name a",
        "a.yt-simple-endpoint[href*='/@']",
        "a[href*='/@']"
      ]);
      hrefCreator = hrefCreator || parseCreatorFromHref(pickAttribute(document, ["a[href*='/@']"], "href"));
      shortsHref = shortsHref || canonicalHref || location.href;
    }

    return {
      platform: "youtube",
      title: titleAttribute || title || pageTitle,
      creator: creator || hrefCreator || channelPageCreator.name || channelPageCreator.handle,
      handle: hrefCreator || channelPageCreator.handle,
      description: getNodeText(node),
      text: [shortsHref, pageTitle].join(" ")
    };
  }

  function extractFacebook(node) {
    var creatorContext = findFacebookCreatorContext(node);
    var creator = getFacebookCreator(node) ||
      getFacebookCreator(creatorContext) ||
      findFacebookNearbyCreator(node) ||
      findFacebookNearbyCreator(creatorContext);

    return {
      platform: "facebook",
      title: "",
      creator: creator,
      handle: creator,
      description: getNodeText(node),
      text: ""
    };
  }

  function findFacebookCreatorContext(node) {
    var nodeRect;
    var contexts;

    if (!node || !node.getBoundingClientRect) {
      return null;
    }

    if (node.closest) {
      var closestContext = node.closest("[role='article'], [role='dialog'], [data-pagelet]");
      if (closestContext) {
        return closestContext;
      }
    }

    nodeRect = node.getBoundingClientRect();
    contexts = Array.prototype.slice.call(document.querySelectorAll("[role='article'], [role='dialog'], [data-pagelet]"));

    return contexts
      .filter(function keepNearbyContext(context) {
        var rect = context.getBoundingClientRect();

        return isVisibleRect(rect) &&
          rect.top <= nodeRect.top + 40 &&
          rect.bottom >= nodeRect.top - 220 &&
          Math.abs((rect.left + rect.right) / 2 - (nodeRect.left + nodeRect.right) / 2) < Math.max(rect.width, nodeRect.width);
      })
      .sort(function nearestFirst(left, right) {
        return Math.abs(left.getBoundingClientRect().top - nodeRect.top) - Math.abs(right.getBoundingClientRect().top - nodeRect.top);
      })[0] || null;
  }

  function cleanFacebookCreatorText(value) {
    var text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return "";
    }

    text = text
      .split(" · ")[0]
      .replace(/\b(Obserwuj|Follow)\b.*$/i, "")
      .replace(/\b(\d+\s*(min|godz|h|d|dni)|wczoraj|yesterday|today|dzisiaj)\b.*$/i, "")
      .trim();

    return text;
  }

  function getFacebookActionWords() {
    return [
      "obserwuj",
      "follow",
      "lubię to",
      "lubie to",
      "like",
      "comment",
      "komentarz",
      "share",
      "udostepnij",
      "udostępnij",
      "facebook",
      "zobacz więcej",
      "see more"
    ];
  }

  function isFacebookActionText(value) {
    var normalized = matcher.normalizeText(value);

    return getFacebookActionWords().some(function isAction(word) {
      return normalized === matcher.normalizeText(word);
    });
  }

  function isFacebookProfileHref(href) {
    var url;
    var path;

    if (!href) {
      return false;
    }

    try {
      url = new URL(href, location.origin);
    } catch (error) {
      return false;
    }

    if (url.hostname.indexOf("facebook.com") === -1) {
      return false;
    }

    path = url.pathname.replace(/\/+$/, "");

    if (path === "/profile.php" && url.search.indexOf("id=") !== -1) {
      return true;
    }

    if (/^\/(reel|watch|videos|video|photo|photos|hashtag|groups|events|marketplace|stories|messages|messenger|notifications|friends|gaming|pages|search|share|help|settings|privacy|ads|bookmarks|saved|memories|live|media|permalink\.php|story\.php)\b/.test(path)) {
      return false;
    }

    return /^\/[^/?#]+$/.test(path);
  }

  function getFacebookCreatorFromLink(link) {
    var text;
    var href;

    if (!link || isFacebookMessengerSurface(link)) {
      return "";
    }

    text = cleanFacebookCreatorText(getNodeText(link) || link.getAttribute("aria-label"));
    href = String(link.href || link.getAttribute("href") || "");

    if (!text || text.length > 80 || (text.indexOf(" ") === -1 && text.length < 2)) {
      return "";
    }

    if (isFacebookActionText(text)) {
      return "";
    }

    if (href && !isFacebookProfileHref(href)) {
      return "";
    }

    return text;
  }

  function getFacebookCreator(node) {
    var links = node && node.querySelectorAll ? Array.prototype.slice.call(node.querySelectorAll("a[href], a[role='link']")) : [];

    for (var index = 0; index < links.length; index += 1) {
      var creator = getFacebookCreatorFromLink(links[index]);

      if (creator) {
        return creator;
      }
    }

    if (node && node.querySelectorAll) {
      var namedCandidates = Array.prototype.slice.call(node.querySelectorAll("strong, h2, h3, span[dir='auto']"));

      for (var candidateIndex = 0; candidateIndex < namedCandidates.length; candidateIndex += 1) {
        var candidateText = cleanFacebookCreatorText(getNodeText(namedCandidates[candidateIndex]));
        var normalizedCandidate = matcher.normalizeText(candidateText);

        if (!candidateText || candidateText.length > 80) {
          continue;
        }

        if (isFacebookActionText(normalizedCandidate)) {
          continue;
        }

        return candidateText;
      }
    }

    return "";
  }

  function findFacebookNearbyCreator(node) {
    var nodeRect;
    var links;

    if (!node || !node.getBoundingClientRect) {
      return "";
    }

    nodeRect = node.getBoundingClientRect();
    links = Array.prototype.slice.call(document.querySelectorAll("a[href], a[role='link']"));

    return links
      .map(function toCreatorCandidate(link) {
        var rect = link.getBoundingClientRect();
        var creator = getFacebookCreatorFromLink(link);
        var centerDelta = Math.abs((rect.left + rect.right) / 2 - (nodeRect.left + nodeRect.right) / 2);

        if (!creator || !isVisibleRect(rect) || isFacebookMessengerSurface(link)) {
          return null;
        }

        if (rect.bottom > nodeRect.top + 60 || rect.bottom < nodeRect.top - 420) {
          return null;
        }

        if (centerDelta > Math.max(nodeRect.width, rect.width, 360)) {
          return null;
        }

        return {
          creator: creator,
          distance: Math.abs(nodeRect.top - rect.bottom)
        };
      })
      .filter(Boolean)
      .sort(function nearestFirst(left, right) {
        return left.distance - right.distance;
      })
      .map(function pickCreator(candidate) {
        return candidate.creator;
      })[0] || "";
  }

  function extractInstagram(node) {
    var profileLink = node.querySelector("a[href^='/']:not([href*='/reel/']):not([href*='/p/']):not([href*='/explore/'])");
    var creator = profileLink ? getNodeText(profileLink) : "";
    var hashtags = Array.prototype.slice.call(node.querySelectorAll("a[href*='/explore/tags/']"))
      .map(getNodeText)
      .join(" ");

    return {
      platform: "instagram",
      title: "",
      creator: creator,
      handle: creator,
      hashtags: hashtags,
      description: getNodeText(node),
      text: ""
    };
  }

  function getExtractor(platform) {
    if (platform === "youtube") {
      return extractYouTube;
    }
    if (platform === "facebook") {
      return extractFacebook;
    }
    if (platform === "instagram") {
      return extractInstagram;
    }
    return function fallback(node) {
      return {
        platform: platform,
        description: getNodeText(node)
      };
    };
  }

  function findYouTubeHomeShortsCandidates() {
    var nodes = [];

    [
      "ytd-rich-section-renderer",
      "ytd-reel-shelf-renderer",
      "ytd-rich-shelf-renderer",
      "ytm-rich-section-renderer"
    ].forEach(function collectShelf(selector) {
      nodes = nodes.concat(Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function keepShortsShelf(node) {
        return !isDocumentScaleContainer(node) && !!node.querySelector("a[href*='/shorts/'], ytd-shorts-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer");
      }));
    });

    Array.prototype.slice.call(document.querySelectorAll("a[href*='/shorts/']")).forEach(function collectFromLink(anchor) {
      var shelf = closestAny(anchor, [
        "ytd-rich-section-renderer",
        "ytd-reel-shelf-renderer",
        "ytd-rich-shelf-renderer",
        "ytm-rich-section-renderer"
      ]);
      var card = getYouTubeShortsCard(anchor);

      if (shelf && !isDocumentScaleContainer(shelf)) {
        nodes.push(shelf);
      }

      if (card && !isDocumentScaleContainer(card)) {
        nodes.push(card);
      }
    });

    return nodes;
  }

  function findYouTubeCandidates() {
    var nodes = [];
    var activePlayer;

    if (isYouTubeHomePage()) {
      return uniqueNodes(findYouTubeHomeShortsCandidates());
    }

    if (location.pathname.indexOf("/shorts") === -1 && !isShortsWatchPage() && !isProbablyShortWatchContext()) {
      return [];
    }

    if (isShortsWatchPage()) {
      [
        "ytd-reel-video-renderer",
        "ytd-shorts-video-renderer",
        "ytd-reel-player-renderer",
        "ytd-shorts-player"
      ].forEach(function collect(selector) {
        nodes = nodes.concat(Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function rejectLarge(node) {
          return !isDocumentScaleContainer(node);
        }));
      });
    } else {
      [
        "ytd-shorts-lockup-view-model",
        "ytm-shorts-lockup-view-model",
        "yt-lockup-view-model",
        "ytd-rich-item-renderer"
      ].forEach(function collect(selector) {
        nodes = nodes.concat(Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function keepShortsCard(node) {
          return !isDocumentScaleContainer(node) && !!node.querySelector("a[href*='/shorts/']");
        }));
      });
    }

    Array.prototype.slice.call(document.querySelectorAll("a[href*='/shorts/']")).forEach(function collectFromLink(anchor) {
      var card = getYouTubeShortsCard(anchor);

      if (card) {
        nodes.push(card);
      }
    });

    activePlayer = findActiveYouTubeShortsPlayer();
    if (activePlayer) {
      nodes.push(activePlayer);
    }

    return uniqueNodes(nodes);
  }

  function findFacebookCandidates() {
    var nodes = [];
    var activeReelPlayer;
    var reelWatchContainer;

    activeReelPlayer = findActiveFacebookReelPlayer();
    if (activeReelPlayer) {
      nodes.push(activeReelPlayer);
    } else {
      reelWatchContainer = findFacebookReelWatchContainer();
      if (reelWatchContainer) {
        nodes.push(reelWatchContainer);
      }
    }

    Array.prototype.slice.call(document.querySelectorAll("a[href*='/reel/'], a[href*='/watch/reel/']")).forEach(function collect(anchor) {
      var inlineReelsContainer = findFacebookInlineReelsContainer(anchor);
      var reelCard = findFacebookReelCard(anchor);
      var candidate = inlineReelsContainer || reelCard || closestAny(anchor, ["[role='article']", "[aria-posinset]", "[data-pagelet]"]) || climbToUsefulContainer(anchor);
      if (shouldUseFacebookCandidate(candidate)) {
        nodes.push(candidate);
      }
    });

    Array.prototype.slice.call(document.querySelectorAll("a[href*='/watch/'], a[href*='/videos/'], a[href*='watch/?v=']")).forEach(function collectVideoLink(anchor) {
      var candidate = closestAny(anchor, ["[role='article']", "[aria-posinset]", "[data-pagelet]"]);
      if (shouldUseFacebookCandidate(candidate)) {
        nodes.push(candidate);
      }
    });

    Array.prototype.slice.call(document.querySelectorAll("img, [style*='background-image']")).forEach(function collectMedia(media) {
      var card = findFacebookReelCardFromMedia(media);
      if (card) {
        nodes.push(card);
      }
    });

    Array.prototype.slice.call(document.querySelectorAll("video")).forEach(function collectVideo(video) {
      var rect = video.getBoundingClientRect();
      var reelCard = findFacebookReelCard(video);
      var article = closestAny(video, ["[role='article']", "[aria-posinset]", "[data-pagelet]"]);
      var candidate;

      if (!isPlayableVideoRect(rect)) {
        return;
      }

      if (reelCard) {
        nodes.push(reelCard);
        return;
      }

      if (shouldUseFacebookCandidate(article)) {
        nodes.push(article);
        return;
      }

      candidate = findReasonableVideoContainer(video);
      if (shouldUseFacebookCandidate(candidate)) {
        candidate.dataset.psfFacebookVideoPlayer = "true";
        nodes.push(candidate);
      }
    });

    return uniqueNodes(nodes);
  }

  function findInstagramCandidates() {
    var nodes = [];
    Array.prototype.slice.call(document.querySelectorAll("a[href*='/reel/']")).forEach(function collect(anchor) {
      nodes.push(closestAny(anchor, ["article", "[role='dialog']", "main"]) || climbToUsefulContainer(anchor));
    });

    if (/\/reel\//.test(location.pathname)) {
      var main = document.querySelector("main");
      if (main) {
        nodes.push(main);
      }
    }

    return uniqueNodes(nodes);
  }

  function uniqueNodes(nodes) {
    var seen = new WeakSet();
    return nodes.filter(function filterNode(node) {
      if (!node || seen.has(node) || !document.documentElement.contains(node)) {
        return false;
      }
      seen.add(node);
      return true;
    });
  }

  function findCandidates(platform) {
    if (platform === "youtube") {
      return findYouTubeCandidates();
    }
    if (platform === "facebook") {
      return findFacebookCandidates();
    }
    if (platform === "instagram") {
      return findInstagramCandidates();
    }
    return [];
  }

  function shouldFilter(result) {
    return result.status === "block" || (result.status === "unknown" && config.strictMode);
  }

  function classifyForCurrentContext(video, node) {
    var result = matcher.classifyVideo(video, config);
    var creator = matcher.compactText([video && video.creator, video && video.handle]);
    var blockedCreator;
    var allowedCreator;

    if (video && video.platform === "youtube" && isYouTubeHomePage()) {
      return {
        status: "block",
        reason: "Shortsy ukryte na stronie głównej YouTube."
      };
    }

    if (video && video.platform === "facebook" && shouldHideFacebookInlineReels(node)) {
      return {
        status: "block",
        reason: "Rolki ukryte na Facebooku."
      };
    }

    if (!(video && video.platform === "youtube" && isYouTubeChannelShortsPage())) {
      return result;
    }

    blockedCreator = matcher.creatorMatch(config.blockedCreators, creator);
    if (blockedCreator) {
      return {
        status: "block",
        reason: "Zablokowany twórca: " + blockedCreator,
        match: blockedCreator
      };
    }

    allowedCreator = matcher.creatorMatch(config.allowedCreators, creator);
    if (allowedCreator) {
      return {
        status: "allow",
        reason: "Dozwolony twórca: " + allowedCreator,
        match: allowedCreator
      };
    }

    return {
      status: "block",
      reason: "Twórca nie jest na allowliście."
    };
  }

  function clearFilter(node) {
    node.classList.remove("psf-filtered", "psf-covered", "psf-hidden", "psf-youtube-card", "psf-facebook-reel-card");
    node.removeAttribute("data-psf-status");
    node.removeAttribute("data-psf-reason");
    unblockPlayback(node);

    var overlay = node.querySelector(":scope > .psf-overlay");
    if (overlay) {
      overlay.remove();
    }
  }

  function clearFacebookMessengerFilters() {
    Array.prototype.slice.call(document.querySelectorAll(".psf-filtered")).forEach(function clearMessengerNode(node) {
      if (isFacebookMessengerSurface(node)) {
        clearFilter(node);
      }
    });
  }

  function createOverlay(node, video, result, contentKey) {
    var existing = node.querySelector(":scope > .psf-overlay");
    var isDoomPrompt = shouldShowDoomPrompt(video, contentKey);
    if (existing) {
      existing.remove();
    }

    var overlay = document.createElement("div");
    var title = document.createElement(isDoomPrompt ? "h1" : "div");
    var reason = document.createElement("div");
    var actions = document.createElement("div");
    var showButton = document.createElement("button");

    overlay.className = "psf-overlay";
    if (isDoomPrompt) {
      overlay.classList.add("psf-overlay-doom");
    }
    title.className = "psf-overlay-title";
    reason.className = "psf-overlay-reason";
    actions.className = "psf-overlay-actions";
    if (video && video.platform === "youtube") {
      actions.classList.add("psf-overlay-actions-stacked");
    }

    if (isDoomPrompt) {
      title.textContent = "Czy na pewno chcesz doomscrollować?";
      createDoomPromptActions(actions, contentKey);
    } else {
      title.textContent = getOverlayTitle(video);
      reason.textContent = getOverlayReason(video, result);
      showButton.type = "button";
      showButton.dataset.psfAction = "show-once";
      showButton.dataset.psfContentKey = contentKey || "";
      showButton.textContent = "Pokaż raz";

      actions.appendChild(showButton);
    }

    if (!isDoomPrompt && (video.creator || video.handle)) {
      var creator = video.creator || video.handle;
      var allowButton = document.createElement("button");
      var blockButton = document.createElement("button");

      allowButton.type = "button";
      allowButton.dataset.psfAction = "allow-creator";
      allowButton.dataset.psfCreator = creator;
      allowButton.textContent = video.platform === "youtube" || video.platform === "facebook" ? "Dodaj twórcę" : "Zawsze pozwalaj temu twórcy";

      blockButton.type = "button";
      blockButton.dataset.psfAction = "block-creator";
      blockButton.dataset.psfCreator = creator;
      blockButton.textContent = "Blokuj twórcę";

      actions.appendChild(allowButton);
      actions.appendChild(blockButton);
    }

    overlay.appendChild(title);
    if (!isDoomPrompt) {
      overlay.appendChild(reason);
    }
    overlay.appendChild(actions);
    node.appendChild(overlay);
  }

  function shouldShowFacebookDoomPrompt(video, contentKey) {
    return shouldShowDoomPrompt(video, contentKey);
  }

  function shouldShowDoomPrompt(video, contentKey) {
    var pendingKey;

    if (!video || !contentKey || isAllowedOnceKey(contentKey)) {
      return false;
    }

    if (!isSequentialDoomContext(video.platform)) {
      return false;
    }

    pendingKey = pendingDoomPromptKeys[video.platform] || "";

    return !!pendingKey && pendingKey !== contentKey;
  }

  function createDoomPromptActions(actions, contentKey) {
    var yesButton = document.createElement("button");
    var noButton = document.createElement("button");

    yesButton.type = "button";
    yesButton.dataset.psfAction = "doom-yes";
    yesButton.dataset.psfContentKey = contentKey || "";
    yesButton.textContent = "TAK, odblokuj króliczą norę";

    noButton.type = "button";
    noButton.dataset.psfAction = "doom-no";
    noButton.textContent = "NIE, chcę wyjść z Matrixa";

    actions.appendChild(yesButton);
    actions.appendChild(noButton);
  }

  function getOverlayTitle(video) {
    if (video && (video.platform === "facebook" || video.platform === "youtube")) {
      return "BleSSScrolling oszczędza Ci tego gówna";
    }

    return "Ukryto przez filtr";
  }

  function getOverlayReason(video, result) {
    var fallback = "Ten film nie pasuje do aktualnych reguł.";
    var reason = (result && result.reason) || fallback;

    if (video && (video.platform === "facebook" || video.platform === "youtube") && reason === "Brak dopasowania do whitelisty psychologii.") {
      return "Brak dopasowania do whitelisty.";
    }

    return reason;
  }

  function applyFilter(node, video, result, contentKey) {
    if (isDocumentScaleContainer(node) && !(video && video.platform === "facebook" && isFacebookActiveReelNode(node))) {
      return;
    }

    if (video && video.platform === "facebook" && isFacebookMessengerSurface(node)) {
      clearFilter(node);
      return;
    }

    if (video && video.platform === "facebook" && !shouldUseFacebookCandidate(node)) {
      clearFilter(node);
      return;
    }

    node.classList.add("psf-filtered");
    if (video && video.platform === "youtube") {
      node.classList.add("psf-youtube-card");
    } else {
      node.classList.remove("psf-youtube-card");
    }
    if (video && video.platform === "facebook" && isFacebookReelCard(node)) {
      node.classList.add("psf-facebook-reel-card");
    } else {
      node.classList.remove("psf-facebook-reel-card");
    }
    node.dataset.psfStatus = result.status;
    node.dataset.psfReason = result.reason || "";
    blockPlayback(node);

    if (video && video.platform === "youtube" && isYouTubeHomePage()) {
      var homeOverlay = node.querySelector(":scope > .psf-overlay");
      if (homeOverlay) {
        homeOverlay.remove();
      }
      node.classList.add("psf-hidden");
      node.classList.remove("psf-covered");
      return;
    }

    if (video && video.platform === "facebook" && shouldHideFacebookInlineReels(node)) {
      var facebookOverlay = node.querySelector(":scope > .psf-overlay");
      if (facebookOverlay) {
        facebookOverlay.remove();
      }
      node.classList.add("psf-hidden");
      node.classList.remove("psf-covered");
      return;
    }

    if (config.overlayMode) {
      node.classList.add("psf-covered");
      node.classList.remove("psf-hidden");
      createOverlay(node, video, result, contentKey);
    } else {
      node.classList.add("psf-hidden");
      node.classList.remove("psf-covered");
    }
  }

  function scan() {
    var platform = getPlatform();
    var extractor = getExtractor(platform);
    var candidates = findCandidates(platform);

    if (platform === "facebook") {
      clearFacebookMessengerFilters();
    }

    if ((platform === "facebook" || platform === "youtube") && !isSequentialDoomContext(platform)) {
      pendingDoomPromptKeys[platform] = "";
    }

    candidates.forEach(function process(node) {
      var video = extractor(node);
      var textFingerprint = getNodeFingerprint(node, video);
      var contentKey = getContentKey(platform, node, video);
      var allowedOnceFingerprint = allowedOnce.get(node);
      var previous;
      var result;

      if (((platform === "facebook" || platform === "youtube") && isAllowedOnceKey(contentKey)) || (allowedOnceFingerprint && allowedOnceFingerprint === textFingerprint)) {
        clearFilter(node);
        return;
      }

      if (allowedOnceFingerprint) {
        allowedOnce.delete(node);
      }

      previous = processedNodes.get(node);
      if (previous && previous.config === config && previous.textFingerprint === textFingerprint) {
        if (node.classList.contains("psf-filtered")) {
          blockPlayback(node);
        }
        return;
      }

      result = classifyForCurrentContext(video, node);
      processedNodes.set(node, {
        config: config,
        textFingerprint: textFingerprint
      });

      if (shouldFilter(result)) {
        applyFilter(node, video, result, contentKey);
      } else {
        clearFilter(node);
      }
    });
  }

  function scheduleScan(delay) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, typeof delay === "number" ? delay : 160);
  }

  document.addEventListener("click", function handleOverlayClick(event) {
    var button = event.target.closest(".psf-overlay button");

    if (!button) {
      return;
    }

    var node = button.closest(".psf-filtered");
    var action = button.dataset.psfAction;
    var creator = button.dataset.psfCreator;
    var contentKey = button.dataset.psfContentKey || "";

    event.preventDefault();
    event.stopPropagation();

    if (!node) {
      return;
    }

    if (action === "show-once") {
      if (getPlatform() === "facebook" || getPlatform() === "youtube") {
        contentKey = contentKey || getContentKey(getPlatform(), node, getExtractor(getPlatform())(node));
        rememberAllowedOnceKey(contentKey);
        pendingDoomPromptKeys[getPlatform()] = isSequentialDoomContext(getPlatform()) ? contentKey : "";
        clearPlatformFiltersForKey(getPlatform(), contentKey);
      } else {
        allowedOnce.set(node, getNodeFingerprint(node, getExtractor(getPlatform())(node)));
      }
      clearFilter(node);
      return;
    }

    if (action === "doom-yes") {
      contentKey = contentKey || getContentKey(getPlatform(), node, getExtractor(getPlatform())(node));
      rememberAllowedOnceKey(contentKey);
      pendingDoomPromptKeys[getPlatform()] = isSequentialDoomContext(getPlatform()) ? contentKey : "";
      clearPlatformFiltersForKey(getPlatform(), contentKey);
      clearFilter(node);
      return;
    }

    if (action === "doom-no") {
      pendingDoomPromptKeys[getPlatform()] = "";
      location.assign(getPlatform() === "youtube" ? "https://www.youtube.com/" : "https://www.facebook.com/");
      return;
    }

    if (action === "allow-creator") {
      addToList("allowedCreators", creator);
      return;
    }

    if (action === "block-creator") {
      addToList("blockedCreators", creator);
    }
  }, true);

  document.addEventListener("play", function handleBlockedPlay(event) {
    if (event.target && event.target.tagName === "VIDEO") {
      scheduleScan(20);
      enforceBlockedPlayback(event.target);
    }
  }, true);

  document.addEventListener("loadedmetadata", function handleLoadedMetadata(event) {
    if (event.target && event.target.tagName === "VIDEO") {
      scheduleScan(20);
    }
  }, true);

  document.addEventListener("volumechange", function handleBlockedVolumeChange(event) {
    if (event.target && event.target.tagName === "VIDEO") {
      enforceBlockedPlayback(event.target);
    }
  }, true);

  storageGet(function init(loadedConfig) {
    config = loadedConfig;
    scan();

    new MutationObserver(function onMutation() {
      scheduleScan();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function onStorageChanged(changes, areaName) {
      var changedConfig = changes[defaults.STORAGE_KEY];

      if (areaName !== "local" || !changedConfig) {
        return;
      }

      config = defaults.mergeConfig(changedConfig.newValue);
      processedNodes = new WeakMap();
      scheduleScan(20);
    });
  }

  window.addEventListener("yt-navigate-finish", function onYouTubeNavigate() {
    scheduleScan(50);
  });
  window.addEventListener("popstate", function onPopstate() {
    scheduleScan(50);
  });
  window.addEventListener("scroll", function onScroll() {
    scheduleScan(80);
  }, {
    passive: true
  });

  ["pushState", "replaceState"].forEach(function wrapHistoryMethod(methodName) {
    var original = history[methodName];

    history[methodName] = function wrappedHistoryMethod() {
      var result = original.apply(this, arguments);
      scheduleScan(50);
      return result;
    };
  });
})();
