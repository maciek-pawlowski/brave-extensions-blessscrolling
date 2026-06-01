(function initOptionsPage() {
  "use strict";

  var defaults = window.ShortMindDefaults;
  var fields = [
    "blockedCreators",
    "blockedKeywords"
  ];

  function getElement(id) {
    return document.getElementById(id);
  }

  function showStatus(message) {
    var status = getElement("status");
    status.textContent = message;
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(function clearStatus() {
      status.textContent = "";
    }, 2200);
  }

  function parseList(value) {
    return String(value || "")
      .split(/\n|,/)
      .map(function trim(item) {
        return item.trim();
      })
      .filter(Boolean);
  }

  function serializeList(list) {
    return defaults.uniqueList(list).join("\n");
  }

  function readForm() {
    var nextConfig = {
      enabled: getElement("enabled").checked,
      overlayMode: getElement("overlayMode").checked
    };

    fields.forEach(function readField(name) {
      nextConfig[name] = parseList(getElement(name).value);
    });

    return defaults.mergeConfig(nextConfig);
  }

  function writeForm(config) {
    var activeConfig = defaults.mergeConfig(config);

    getElement("enabled").checked = activeConfig.enabled;
    getElement("overlayMode").checked = activeConfig.overlayMode;

    fields.forEach(function writeField(name) {
      getElement(name).value = serializeList(activeConfig[name]);
    });
  }

  function loadConfig() {
    chrome.storage.local.get(defaults.STORAGE_KEY, function handleResult(result) {
      writeForm(result && result[defaults.STORAGE_KEY]);
    });
  }

  function saveConfig(config, message) {
    var payload = {};
    payload[defaults.STORAGE_KEY] = defaults.mergeConfig(config);
    chrome.storage.local.set(payload, function handleSaved() {
      writeForm(payload[defaults.STORAGE_KEY]);
      showStatus(message || "Zapisano");
    });
  }

  getElement("save").addEventListener("click", function onSave() {
    saveConfig(readForm(), "Zapisano");
  });

  getElement("reset").addEventListener("click", function onReset() {
    saveConfig(defaults.DEFAULT_CONFIG, "Przywrócono domyślne");
  });

  ["enabled", "overlayMode"].forEach(function bindCheckbox(id) {
    getElement(id).addEventListener("change", function onToggle() {
      saveConfig(readForm(), "Zapisano");
    });
  });

  loadConfig();
})();
