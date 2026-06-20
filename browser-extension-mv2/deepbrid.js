const bridgeChannel = "deepbridge-finder-page";
const script = document.createElement("script");
script.src = chrome.runtime.getURL("page-fetch.js");
script.onload = () => script.remove();
script.onerror = () => console.error("Deepbridge Finder page relay could not be injected.");
(document.head || document.documentElement).appendChild(script);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "finder-request") return;
  const id = `${Date.now()}-${Math.random()}`;
  const onResponse = event => {
    const data = event.data;
    if (event.source !== window || data?.channel !== bridgeChannel || data?.id !== id) return;
    window.removeEventListener("message", onResponse);
    sendResponse(data.result);
  };
  window.addEventListener("message", onResponse);
  console.debug("Deepbridge Finder relay request", id);
  window.postMessage({ channel: bridgeChannel, type: "request", id, request: message.request }, location.origin);
  return true;
});
