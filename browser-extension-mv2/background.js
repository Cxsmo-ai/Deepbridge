let bridgeRoot = "";
let polling = false;

function api(path, options) {
  return fetch(`${bridgeRoot}/finder-bridge/${path}`, Object.assign({ credentials: "omit" }, options || {}));
}

function fetchFromDeepbrid(request) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ url: "https://www.deepbrid.com/*" }, tabs => {
      if (!tabs[0] || !tabs[0].id) return reject(new Error("Open an authenticated Deepbrid tab before using Finder."));
      chrome.tabs.sendMessage(tabs[0].id, { type: "finder-request", request }, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response) return reject(new Error("Deepbrid tab did not answer."));
        resolve(response);
      });
    });
  });
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
      catch (error) {
        console.error("Deepbridge Finder bridge request failed", error);
        result = { statusCode: 599, text: JSON.stringify({ error: String(error.message || error) }) };
      }
      await api("respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ id: body.request.id }, result)) });
    }
  } catch (_) {
    // Keep the persistent background page retrying after temporary failures.
  } finally {
    polling = false;
    setTimeout(poll, 500);
  }
}

chrome.runtime.onMessage.addListener(message => {
  if (!message || message.type !== "pair") return;
  const candidate = message.pairingUrl.replace(/\/finder-auth$/, "");
  fetch(`${candidate}/finder-bridge/pair`, { method: "POST", credentials: "omit" })
    .then(response => {
      if (!response.ok) throw new Error("Pairing failed");
      bridgeRoot = candidate;
      chrome.storage.local.set({ bridgeRoot }, poll);
    })
    .catch(() => chrome.storage.local.remove("bridgeRoot"));
});

chrome.storage.local.get("bridgeRoot", value => { bridgeRoot = value.bridgeRoot || ""; poll(); });
