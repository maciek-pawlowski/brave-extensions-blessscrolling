"use strict";

var assert = require("assert");

global.ShortMindDefaults = require("../src/shared/defaults");
var matcher = require("../src/shared/matcher");
var defaults = global.ShortMindDefaults;

function config(overrides) {
  return defaults.mergeConfig(Object.assign({}, defaults.DEFAULT_CONFIG, overrides || {}));
}

function classify(video, overrides) {
  return matcher.classifyVideo(video, config(overrides));
}

assert.strictEqual(
  classify({
    creator: "Dr Anna Psycholog",
    title: "Jak regulacja emocji pomaga w lęku"
  }).status,
  "unknown",
  "psychology keywords should not create implicit allow rules"
);

assert.strictEqual(
  classify({
    creator: "Random Clips",
    title: "Funny prank in a store"
  }).status,
  "block",
  "blocked keywords should be blocked"
);

assert.strictEqual(
  classify({
    creator: "Licensed Therapist",
    title: "Cognitive behavioral therapy coping skills for panic attacks"
  }).status,
  "unknown",
  "English psychology keywords should not create implicit allow rules"
);

assert.strictEqual(
  classify({
    creator: "Viral Feed",
    title: "Public freakout and crash compilation"
  }).status,
  "block",
  "expanded English nuisance categories should be blocked"
);

assert.strictEqual(
  classify({
    creator: "Blocked Channel",
    title: "Psychologia emocji"
  }, {
    blockedCreators: ["Blocked Channel"]
  }).status,
  "block",
  "blocked creators should block"
);

assert.strictEqual(
  classify({
    creator: "Neutral Channel",
    title: "A quiet day"
  }).status,
  "unknown",
  "unmatched videos should remain unknown for strict-mode handling"
);

assert.strictEqual(
  matcher.normalizeText("Lęk i przywiązanie"),
  "lek i przywiazanie",
  "normalization should remove Polish diacritics"
);

console.log("matcher tests ok");
