chrome.storage.local.get("bridgeRoot", async ({ bridgeRoot }) => {
  const pairing = document.getElementById("pairing");
  const tab = document.getElementById("tab");
  const tabs = await new Promise(resolve => chrome.tabs.query({ url: "https://www.deepbrid.com/*" }, resolve));
  tab.textContent = tabs.length ? "Authenticated Deepbrid tab detected." : "Open a logged-in Deepbrid tab.";
  tab.className = tabs.length ? "ok" : "warn";
  if (!bridgeRoot) { pairing.textContent = "Not paired: open a dashboard pairing URL."; pairing.className = "warn"; return; }
  try {
    const response = await fetch(`${bridgeRoot}/finder-bridge/status`, { credentials: "omit" });
    const status = await response.json();
    pairing.textContent = status.paired ? "Paired with Oracle: persistent bridge active." : "Pairing was not accepted by Oracle.";
    pairing.className = status.paired ? "ok" : "warn";
  } catch (_) { pairing.textContent = "Cannot reach Oracle pairing status."; pairing.className = "warn"; }
});
