let bridgeRoot = "";
let polling = false;

function api(path, options = {}) {
  return fetch(`${bridgeRoot}/finder-bridge/${path}`, { credentials: "omit", ...options });
}

async function fetchFromDeepbrid(request) {
  const tabs = await chrome.tabs.query({ url: "https://www.deepbrid.com/*" });
  if (!tabs[0]?.id) throw new Error("Open an authenticated Deepbrid tab before using Finder.");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: async ({ url, accept, ajax }) => {
      const response = await fetch(url, {
        credentials: "include",
        headers: { Accept: accept, ...(ajax ? { "X-Requested-With": "XMLHttpRequest" } : {}) }
      });
      return { statusCode: response.status, text: await response.text() };
    },
    args: [request]
  });
  return result.result;
}

async function poll() {
  if (!bridgeRoot || polling) return;
  polling = true;
  try {
    const response = await api("poll?wait=1");
    const body = await response.json();
    if (body.request) {
      let result;
      try { result = await fetchFromDeepbrid(body.request); }
      catch (error) { result = { statusCode: 599, text: JSON.stringify({ error: String(error.message || error) }) }; }
      await api("respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: body.request.id, ...result }) });
    }
  } catch (_) {
    // A temporary network failure is retried by the next poll.
  } finally {
    polling = false;
    setTimeout(poll, 800);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "pair") return;
  const candidate = message.pairingUrl.replace(/\/finder-auth$/, "");
  fetch(`${candidate}/finder-bridge/pair`, { method: "POST", credentials: "omit" })
    .then(async response => {
      if (!response.ok) throw new Error(`Pairing failed: ${response.status}`);
      bridgeRoot = candidate;
      await chrome.storage.local.set({ bridgeRoot });
      poll();
    })
    .catch(() => chrome.storage.local.remove("bridgeRoot"));
});

chrome.storage.local.get("bridgeRoot").then(({ bridgeRoot: saved }) => { bridgeRoot = saved || ""; poll(); });
