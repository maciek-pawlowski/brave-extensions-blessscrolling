(function initShortsFilterMatcher(global) {
  "use strict";

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactText(parts) {
    return (Array.isArray(parts) ? parts : [])
      .map(function toString(part) {
        return String(part || "").trim();
      })
      .filter(Boolean)
      .join(" ");
  }

  function listMatch(list, haystack) {
    var normalizedHaystack = normalizeText(haystack);

    if (!normalizedHaystack || !Array.isArray(list)) {
      return null;
    }

    for (var index = 0; index < list.length; index += 1) {
      var rawNeedle = list[index];
      var needle = normalizeText(rawNeedle);

      if (needle && normalizedHaystack.indexOf(needle) !== -1) {
        return rawNeedle;
      }
    }

    return null;
  }

  function creatorMatch(list, creator) {
    var normalizedCreator = normalizeText(creator).replace(/^@/, "");

    if (!normalizedCreator || !Array.isArray(list)) {
      return null;
    }

    for (var index = 0; index < list.length; index += 1) {
      var rawCandidate = list[index];
      var candidate = normalizeText(rawCandidate).replace(/^@/, "");

      if (!candidate) {
        continue;
      }

      if (normalizedCreator === candidate || normalizedCreator.indexOf(candidate) !== -1 || candidate.indexOf(normalizedCreator) !== -1) {
        return rawCandidate;
      }
    }

    return null;
  }

  function classifyVideo(video, config) {
    var activeConfig = global.ShortMindDefaults
      ? global.ShortMindDefaults.mergeConfig(config)
      : config;
    var creator = compactText([video && video.creator, video && video.handle]);
    var text = compactText([
      creator,
      video && video.title,
      video && video.description,
      video && video.hashtags,
      video && video.text
    ]);
    var blockedCreator = creatorMatch(activeConfig.blockedCreators, creator);
    var blockedKeyword = listMatch(activeConfig.blockedKeywords, text);

    if (activeConfig.enabled === false) {
      return {
        status: "allow",
        reason: "Rozszerzenie jest wyłączone."
      };
    }

    if (blockedCreator) {
      return {
        status: "block",
        reason: "Zablokowany twórca: " + blockedCreator,
        match: blockedCreator
      };
    }

    if (blockedKeyword) {
      return {
        status: "block",
        reason: "Zablokowane słowo: " + blockedKeyword,
        match: blockedKeyword
      };
    }

    return {
      status: "unknown",
      reason: "Brak dopasowania do reguł blokowania."
    };
  }

  var api = {
    normalizeText: normalizeText,
    compactText: compactText,
    listMatch: listMatch,
    creatorMatch: creatorMatch,
    classifyVideo: classifyVideo
  };

  global.ShortMindMatcher = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
