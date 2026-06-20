async function render() {
  const { bridgeRoot } = await chrome.storage.local.get("bridgeRoot");
  const tabs = await chrome.tabs.query({ url: "https://www.deepbrid.com/*" });
  const pairing = document.getElementById("pairing");
  const tab = document.getElementById("tab");
  if (!bridgeRoot) {
    pairing.textContent = "Not paired: open a dashboard pairing URL.";
    pairing.className = "warn";
  } else {
    try {
      const response = await fetch(`${bridgeRoot}/finder-bridge/status`, { credentials: "omit" });
      const status = await response.json();
      pairing.textContent = status.paired ? "Paired with Oracle: ready for Finder searches." : "Pairing was not accepted by Oracle. Reload the pairing URL.";
      pairing.className = status.paired ? "ok" : "warn";
    } catch (_) {
      pairing.textContent = "Cannot reach Oracle pairing status.";
      pairing.className = "warn";
    }
  }
  tab.textContent = tabs.length ? "Authenticated Deepbrid tab detected." : "Open a logged-in Deepbrid tab before Finder searches.";
  tab.className = tabs.length ? "ok" : "warn";
}
render();
