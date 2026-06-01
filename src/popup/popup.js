(function initPopup() {
  "use strict";

  var defaults = window.ShortMindDefaults;
  var currentConfig = defaults.mergeConfig();

  function getElement(id) {
    return document.getElementById(id);
  }

  function showStatus(message) {
    getElement("status").textContent = message;
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(function clearStatus() {
      getElement("status").textContent = "";
    }, 1600);
  }

  function writeForm(config) {
    currentConfig = defaults.mergeConfig(config);
    getElement("enabled").checked = currentConfig.enabled;
  }

  function saveConfig() {
    var payload = {};
    currentConfig.enabled = getElement("enabled").checked;
    payload[defaults.STORAGE_KEY] = defaults.mergeConfig(currentConfig);
    chrome.storage.local.set(payload, function onSaved() {
      writeForm(payload[defaults.STORAGE_KEY]);
      showStatus("Zapisano");
    });
  }

  chrome.storage.local.get(defaults.STORAGE_KEY, function handleResult(result) {
    writeForm(result && result[defaults.STORAGE_KEY]);
  });

  getElement("enabled").addEventListener("change", saveConfig);
  getElement("options").addEventListener("click", function openOptions() {
    chrome.runtime.openOptionsPage();
  });
})();
