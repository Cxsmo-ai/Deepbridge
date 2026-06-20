async function render() {
  const { bridgeRoot } = await chrome.storage.local.get("bridgeRoot");
  const tabs = await chrome.tabs.query({ url: "https://www.deepbrid.com/*" });
  const pairing = document.getElementById("pairing");
  const tab = document.getElementById("tab");
  pairing.textContent = bridgeRoot ? "Paired configuration: ready to poll Oracle." : "Not paired: open a dashboard pairing URL.";
  pairing.className = bridgeRoot ? "ok" : "warn";
  tab.textContent = tabs.length ? "Authenticated Deepbrid tab detected." : "Open a logged-in Deepbrid tab before Finder searches.";
  tab.className = tabs.length ? "ok" : "warn";
}
render();
