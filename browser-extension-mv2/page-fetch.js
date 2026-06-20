window.addEventListener("message", async event => {
  const data = event.data;
  if (event.source !== window || data?.channel !== "deepbridge-finder-page" || data?.type !== "request") return;
  let result;
  try {
    const response = await fetch(data.request.url, {
      credentials: "include",
      headers: Object.assign({ Accept: data.request.accept }, data.request.ajax ? { "X-Requested-With": "XMLHttpRequest" } : {})
    });
    result = { statusCode: response.status, text: await response.text() };
  } catch (error) {
    result = { statusCode: 599, text: JSON.stringify({ error: String(error.message || error) }) };
  }
  window.postMessage({ channel: "deepbridge-finder-page", id: data.id, result }, location.origin);
});
