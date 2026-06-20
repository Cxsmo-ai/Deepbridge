chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "finder-request") return;
  fetch(message.request.url, {
    credentials: "include",
    headers: Object.assign({ Accept: message.request.accept }, message.request.ajax ? { "X-Requested-With": "XMLHttpRequest" } : {})
  }).then(async response => {
    sendResponse({ statusCode: response.status, text: await response.text() });
  }).catch(error => sendResponse({ statusCode: 599, text: JSON.stringify({ error: String(error.message || error) }) }));
  return true;
});
