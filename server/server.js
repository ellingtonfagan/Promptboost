const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 100 * 1024;
const VALID_MODELS = new Set(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
const VALID_SURFACES = new Set(["gmail", "substack", "chat", "generic"]);
const VALID_MODES = new Set(["simple", "structured"]);
const REVIEW_OUTPUT_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["grammar", "spelling", "punctuation", "clarity", "tone"] },
            quote: { type: "string" },
            fix: { type: "string" },
            why: { type: "string" }
          },
          required: ["type", "quote", "fix", "why"],
          additionalProperties: false
        }
      },
      good: { type: "string" },
      better: { type: "string" }
    },
    required: ["issues", "good", "better"],
    additionalProperties: false
  }
};

const CHAT_PROMPTS = {
  simple: "Rewrite the developer's prompt so an AI coding assistant can act on it directly. Keep their intent exactly; do not add requirements they did not ask for. Make implicit context explicit, name the concrete artifacts involved, and state what done looks like. Only rewrite the text inside the text_to_rewrite block; surrounding_context exists only to inform tone, audience, and references. Return one focused paragraph and nothing else. Return only the rewritten text, with no preamble.",
  structured: "Rewrite the developer's prompt as an implementation brief with exactly four sections: ROLE, OBJECTIVE, SCOPE, PLAN. ROLE names the kind of engineer the task calls for. OBJECTIVE states what done looks like in one or two sentences. SCOPE lists what the change touches and, where it matters, what it must not touch. PLAN gives the ordered steps. Preserve their intent exactly; do not invent requirements. Only rewrite the text inside the text_to_rewrite block; surrounding_context exists only to inform tone, audience, and references. Return only the brief. Return only the rewritten text, with no preamble."
};

const SURFACE_PROMPTS = {
  gmail: "Rewrite a reply so it is clear, direct, and appropriately brief. Match the register of the thread in context. Preserve every commitment, date, and number exactly. Do not invent facts and do not add pleasantries the writer did not write. Only rewrite the text inside the text_to_rewrite block; surrounding_context exists only to inform tone, audience, and references. Return only the rewritten text, with no preamble.",
  substack: "Tighten prose while preserving the writer's voice and argument. Do not neutralize distinctive phrasing into house style. Do not add a conclusion the writer did not write. Only rewrite the text inside the text_to_rewrite block; surrounding_context exists only to inform tone, audience, and references. Return only the rewritten text, with no preamble.",
  generic: "Clean up the text, preserving meaning and voice. Only rewrite the text inside the text_to_rewrite block; surrounding_context exists only to inform tone, audience, and references. Return only the rewritten text, with no preamble."
};

const REVIEW_PROMPT = "You are reviewing an email draft. Report every grammar, spelling, and punctuation error you find, quoting the exact text and giving the correction. Also report clarity and tone issues only when they materially affect the email. The quote value must be text that appears verbatim in the draft, so the UI can locate it. Then produce two versions. good fixes only errors and leaves the writer's voice, structure, and word choice alone; it is the draft, made correct. better rewrites for clarity, concision, and an appropriate tone for the thread, and may restructure. Preserve every commitment, date, name, and number exactly in both. Invent nothing. If the draft has no errors, return an empty issues array; do not manufacture problems to seem useful.";

const config = loadConfig();
console.log(`PromptBoost bridge starting: provider=${config.provider}, model=${config.model}, port=${config.port}`);

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, { ok: false, error: error.message || "Internal server error." });
  });
});

server.on("error", (error) => {
  console.error(`PromptBoost bridge failed to start on http://${HOST}:${config.port}: ${error.message}`);
  process.exit(1);
});

server.listen(config.port, HOST, () => {
  console.log(`PromptBoost bridge listening on http://${HOST}:${config.port}`);
});

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  if (!fs.existsSync(configPath)) {
    console.error("PromptBoost server config is missing. Copy server/config.example.json to server/config.json and add your Anthropic API key.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error(`PromptBoost server config is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  const provider = parsed.provider || "anthropic";
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  const model = parsed.model || "claude-sonnet-5";
  const port = Number(parsed.port || 8787);

  if (provider !== "anthropic") {
    console.error("PromptBoost server currently supports provider=\"anthropic\" only.");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("PromptBoost server config is missing apiKey. Add your Anthropic API key to server/config.json.");
    process.exit(1);
  }
  if (!VALID_MODELS.has(model)) {
    console.error("PromptBoost server config model must be one of: claude-opus-5, claude-sonnet-5, claude-haiku-4-5.");
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PromptBoost server config port must be an integer from 1 to 65535.");
    process.exit(1);
  }

  return { provider, apiKey, model, port };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${HOST}:${config.port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    maybeSetCors(response, request.headers.origin);
    return sendJson(response, 200, { ok: true, provider: config.provider, model: config.model });
  }

  if (request.method === "OPTIONS") {
    const origin = request.headers.origin || "";
    if (!isChromeExtensionOrigin(origin)) {
      return sendJson(response, 403, { ok: false, error: "Forbidden origin." });
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "POST" && (url.pathname === "/rewrite" || url.pathname === "/review")) {
    const origin = request.headers.origin || "";
    if (!isChromeExtensionOrigin(origin)) {
      return sendJson(response, 403, { ok: false, error: "Forbidden origin." });
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (url.pathname === "/review") {
      return handleReview(request, response);
    }
    return handleRewrite(request, response);
  }

  sendJson(response, 404, { ok: false, error: "Not found." });
}

async function handleRewrite(request, response) {
  const signal = clientAbortSignal(request, response);
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(response, status, { ok: false, error: error.message });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const context = typeof payload.context === "string" ? payload.context.trim() : "";
  const mode = VALID_MODES.has(payload.mode) ? payload.mode : "simple";
  const surface = VALID_SURFACES.has(payload.surface) ? payload.surface : "generic";

  if (!text) {
    return sendJson(response, 400, { ok: false, error: "text is required." });
  }

  try {
    const rewritten = await rewriteWithAnthropic({
      text,
      context,
      mode,
      surface,
      signal
    });
    sendJson(response, 200, { ok: true, text: rewritten });
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    sendJson(response, 502, { ok: false, error: error.message });
  }
}

async function handleReview(request, response) {
  const signal = clientAbortSignal(request, response);
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(response, status, { ok: false, error: error.message });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const context = typeof payload.context === "string" ? payload.context.trim() : "";
  const surface = payload.surface === "gmail" ? "gmail" : "";

  if (!text) {
    return sendJson(response, 400, { ok: false, error: "text is required." });
  }
  if (!surface) {
    return sendJson(response, 400, { ok: false, error: "surface must be gmail." });
  }

  try {
    const review = await reviewWithAnthropic({ text, context, signal });
    sendJson(response, 200, { ok: true, review });
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    sendJson(response, 502, { ok: false, error: error.message });
  }
}

function clientAbortSignal(_request, response) {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body exceeds 100KB.");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function rewriteWithAnthropic({ text, context, mode, surface, signal }) {
  const data = await callAnthropic({
    system: systemPromptFor(surface, mode),
    userContent: composeUserMessage(text, context),
    outputConfig: { effort: "low" },
    refusalMessage: "Anthropic refused to rewrite this text.",
    signal
  });

  const rewritten = extractTextBlocks(data).trim();
  if (!rewritten) {
    throw new Error("Anthropic returned an empty rewrite.");
  }

  return rewritten;
}

async function reviewWithAnthropic({ text, context, signal }) {
  const data = await callAnthropic({
    system: REVIEW_PROMPT,
    userContent: composeUserMessage(text, context),
    outputConfig: {
      effort: "low",
      format: REVIEW_OUTPUT_FORMAT
    },
    refusalMessage: "Anthropic refused to review this text.",
    signal
  });

  const raw = extractTextBlocks(data).trim();
  if (!raw) {
    throw new Error("Anthropic returned an empty review.");
  }

  let review;
  try {
    review = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Anthropic returned invalid review JSON: ${error.message}`);
  }

  return normalizeReview(review);
}

function callAnthropic({ system, userContent, outputConfig, refusalMessage, signal }) {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: outputConfig,
    system,
    messages: [{ role: "user", content: userContent }]
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      method: "POST",
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      signal,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const data = parseJson(raw);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(providerErrorMessage(data) || `Anthropic request failed with HTTP ${response.statusCode}.`));
          return;
        }
        if (data.stop_reason === "refusal") {
          reject(new Error(refusalMessage));
          return;
        }

        resolve(data);
      });
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function extractTextBlocks(data) {
  return Array.isArray(data.content)
    ? data.content
        .filter((block) => block && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("")
    : "";
}

function normalizeReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new Error("Anthropic review JSON was not an object.");
  }
  if (!Array.isArray(review.issues) || typeof review.good !== "string" || typeof review.better !== "string") {
    throw new Error("Anthropic review JSON did not match the expected schema.");
  }

  const issues = review.issues.map((issue) => ({
    type: String(issue.type || ""),
    quote: String(issue.quote || ""),
    fix: String(issue.fix || ""),
    why: String(issue.why || "")
  }));

  return {
    issues,
    good: review.good,
    better: review.better
  };
}

function systemPromptFor(surface, mode) {
  if (surface === "chat") {
    return CHAT_PROMPTS[mode] || CHAT_PROMPTS.simple;
  }
  return SURFACE_PROMPTS[surface] || SURFACE_PROMPTS.generic;
}

function composeUserMessage(text, context) {
  if (!context) {
    return `<text_to_rewrite>\n${text}\n</text_to_rewrite>`;
  }

  return `<surrounding_context>\n${context}\n</surrounding_context>\n\n<text_to_rewrite>\n${text}\n</text_to_rewrite>`;
}

function isChromeExtensionOrigin(origin) {
  return origin.startsWith("chrome-extension://");
}

function maybeSetCors(response, origin) {
  if (isChromeExtensionOrigin(origin || "")) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function parseJson(raw) {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { error: { message: raw } };
  }
}

function providerErrorMessage(data) {
  if (typeof data?.error === "string") {
    return data.error;
  }
  if (typeof data?.error?.message === "string") {
    return data.error.message;
  }
  if (typeof data?.message === "string") {
    return data.message;
  }
  return "";
}
