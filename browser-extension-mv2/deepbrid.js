chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "finder-request") return;
  console.debug("Deepbridge Finder relay request", message.request.url);
  fetch(message.request.url, {
    credentials: "include",
    headers: Object.assign({ Accept: message.request.accept }, message.request.ajax ? { "X-Requested-With": "XMLHttpRequest" } : {})
  }).then(async response => {
    sendResponse({ statusCode: response.status, text: await response.text() });
  }).catch(error => {
    console.error("Deepbridge Finder content request failed", error);
    sendResponse({ statusCode: 599, text: JSON.stringify({ error: String(error.message || error) }) });
  });
  return true;
});
