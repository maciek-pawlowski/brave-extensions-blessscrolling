(function initShortsFilterDefaults(global) {
  "use strict";

  var STORAGE_KEY = "psychShortsFilterConfig";

  var DEFAULT_CONFIG = {
    version: 2,
    enabled: true,
    overlayMode: true,
    blockedCreators: [],
    blockedKeywords: [
      "prank",
      "pranks",
      "comedy",
      "comedian",
      "funny",
      "funniest",
      "meme",
      "memes",
      "skit",
      "stand up",
      "standup",
      "jokes",
      "dad jokes",
      "drama",
      "relationship drama",
      "couple drama",
      "dating drama",
      "cheating story",
      "couple fight",
      "couples fight",
      "breakup drama",
      "zdrada",
      "awantura",
      "smieszne",
      "śmieszne",
      "kotki",
      "kot",
      "funny cats",
      "cat videos",
      "cute cats",
      "pies",
      "dog videos",
      "cute dogs",
      "sklep",
      "klient",
      "kasjer",
      "customer freakout",
      "public freakout",
      "karen",
      "shoplifting",
      "mall drama",
      "wyscigi",
      "wyścigi",
      "race",
      "racing",
      "drag race",
      "street race",
      "supercar",
      "car meet",
      "car crash",
      "crash compilation",
      "wypadek",
      "fails",
      "fail compilation",
      "epic fail",
      "challenge",
      "viral challenge",
      "tiktok trend",
      "celebryci",
      "celebrity gossip",
      "influencer drama",
      "gossip",
      "plotki"
    ]
  };

  function uniqueList(value) {
    var seen = Object.create(null);

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(function normalizeItem(item) {
        return String(item || "").trim();
      })
      .filter(function dedupe(item) {
        var key = item.toLocaleLowerCase();
        if (!item || seen[key]) {
          return false;
        }
        seen[key] = true;
        return true;
      });
  }

  function mergeConfig(raw) {
    var source = raw && typeof raw === "object" ? raw : {};

    return {
      version: DEFAULT_CONFIG.version,
      enabled: source.enabled !== false,
      overlayMode: source.overlayMode !== false,
      blockedCreators: uniqueList(source.blockedCreators || DEFAULT_CONFIG.blockedCreators),
      blockedKeywords: uniqueList(source.blockedKeywords || DEFAULT_CONFIG.blockedKeywords)
    };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    mergeConfig: mergeConfig,
    uniqueList: uniqueList
  };

  global.ShortMindDefaults = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
