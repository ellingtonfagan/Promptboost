const SERVER_BASE_URL = "http://127.0.0.1:8787";
const MESSAGE_ENDPOINTS = {
  REWRITE: "/rewrite",
  REVIEW: "/review"
};
const requestControllers = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ABORT_REQUEST") {
    abortRequest(message.requestId);
    sendResponse({ ok: true });
    return false;
  }

  if (!message || !MESSAGE_ENDPOINTS[message.type]) {
    return false;
  }

  postToServer(MESSAGE_ENDPOINTS[message.type], message.payload, message.requestId)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function postToServer(endpoint, payload, requestId) {
  const controller = requestId ? new AbortController() : null;
  if (requestId) {
    abortRequest(requestId);
    requestControllers.set(requestId, controller);
  }

  let response;
  try {
    response = await fetch(`${SERVER_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller?.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, aborted: true, error: "PromptBoost request was cancelled." };
    }
    if (error.message === "Failed to fetch") {
      return {
        ok: false,
        error: "PromptBoost server isn't running. Start it with: node server/server.js"
      };
    }
    throw error;
  } finally {
    if (requestId && requestControllers.get(requestId) === controller) {
      requestControllers.delete(requestId);
    }
  }

  const data = await readJson(response);
  if (response.ok) {
    return data;
  }

  return { ok: false, error: data.error || `PromptBoost server returned HTTP ${response.status}.` };
}

function abortRequest(requestId) {
  if (!requestId || !requestControllers.has(requestId)) {
    return;
  }
  requestControllers.get(requestId).abort();
  requestControllers.delete(requestId);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { error: text };
  }
}
