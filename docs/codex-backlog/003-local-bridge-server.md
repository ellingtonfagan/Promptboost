# 003 — Local bridge server; extension stores no key

**Status:** `ready` — implement this.

Supersedes the BYOK-in-the-browser design from [001](001-mvp-extension.md).
The API key moves out of the browser entirely.

## Why

Two failures drove this. The key had to be re-entered and never reliably
reached the service worker, and the extension only ever saw the input box —
on Gmail it cannot know what thread you are replying to, which makes the
rewrite useless there.

New shape: a small local server owns the key (read once from a file on disk)
and makes all provider calls. The extension holds no secret, has no key
settings screen, and posts `{text, context}` to `127.0.0.1`.

## Non-goals for this ticket

- MCP / Claude Desktop integration — ticket 004, built on top of this server
- Google Docs support — see "Google Docs" below; needs investigation first
- Packaging, installer, or launchd auto-start — ticket 005
- npm dependencies. Node's built-in `http`/`https` modules are enough.

## Part 1 — `server/server.js`

Plain Node, zero dependencies, run with `node server/server.js`.

**Config.** Read `server/config.json` at startup:

```json
{
  "provider": "anthropic",
  "apiKey": "<anthropic-api-key>",
  "model": "claude-sonnet-5",
  "port": 8787
}
```

If the file is missing, print a clear message telling the user to copy
`server/config.example.json` to `server/config.json` and add their key, then
exit non-zero. Do not start a server that cannot work. Ship
`config.example.json`; `config.json` is already gitignored.

Read config **once at startup**, not per request. On boot print the resolved
provider, model, and port — never the key, not even partially.

**Bind to `127.0.0.1` only.** Not `0.0.0.0`. Nothing off this machine may
reach it.

**Security — this matters more than anything else in this ticket.** A
localhost server holding an API key is reachable by every page the user
visits unless it is gated. Enforce both:

1. Reject any request whose `Origin` header does not start with
   `chrome-extension://`. Return 403. A page on `https://evil.com` fetching
   `127.0.0.1:8787` sends its own origin and is refused.
2. On the CORS preflight (`OPTIONS`), echo `Access-Control-Allow-Origin` only
   for a `chrome-extension://` origin. Never reply with `*`.

Cap request bodies at 100KB, rejecting larger with 413, so a runaway page
context cannot be used to burn tokens.

**Endpoints.**

`GET /health` → `{"ok": true, "provider": "...", "model": "..."}`. No origin
gate on this one — the extension uses it to show whether the server is up.

`POST /rewrite` → body:

```json
{
  "text": "the text to rewrite (required)",
  "context": "surrounding page context (optional, may be empty)",
  "mode": "simple" | "structured",
  "surface": "gmail" | "substack" | "chat" | "generic"
}
```

Response `{"ok": true, "text": "..."}` or `{"ok": false, "error": "..."}`.

**Provider call — Anthropic.** `POST https://api.anthropic.com/v1/messages`
with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type`.
The browser-only header from ticket 001 is **not needed here** — this is Node,
not a browser origin. Do not send it.

Body: `max_tokens: 4096`, `thinking: {"type": "adaptive"}`,
`output_config: {"effort": "low"}`, `system` = the surface template below,
`messages: [{role: "user", content: <composed>}]`.

Valid model IDs are `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` —
no date suffixes, no `-latest`. Do not send `temperature`, `top_p`, `top_k`,
or `budget_tokens`; all are rejected on these models.

Read the reply by filtering `content` for `type === "text"` and joining —
never index `content[0]`, since a thinking block can come first. Check
`stop_reason === "refusal"` before reading content.

**Composing the user message.** When `context` is non-empty, send it as
clearly delimited surrounding material that must not itself be rewritten:

```
<surrounding_context>
...context...
</surrounding_context>

<text_to_rewrite>
...text...
</text_to_rewrite>
```

The system prompt must state that only the `text_to_rewrite` block is to be
returned, and that the context exists to inform tone, audience, and
references. This is the single most important prompt detail in the ticket —
getting it wrong means the model rewrites the whole email thread.

**Surface templates** (constants). Each ends with "Return only the rewritten
text, with no preamble."

- `chat` — the prompt-rewriting behavior from ticket 001, Simple and
  Structured modes.
- `gmail` — rewrite a reply so it is clear, direct, and appropriately brief.
  Match the register of the thread in context. Preserve every commitment,
  date, and number exactly. Do not invent facts and do not add pleasantries
  the writer did not write.
- `substack` — tighten prose while preserving the writer's voice and
  argument. Do not neutralize distinctive phrasing into house style. Do not
  add a conclusion the writer did not write.
- `generic` — clean up the text, preserving meaning and voice.

## Part 2 — the extension

**Delete** `extension/options.html` and `extension/options.js`, and drop
`options_page` / `default_popup` from the manifest. There is no key to
configure.

**manifest.json changes:**
- `host_permissions`: `["http://127.0.0.1:8787/*"]` — remove both provider
  hosts. The browser no longer talks to Anthropic or OpenAI at all.
- Add content-script matches for `https://mail.google.com/*` and
  `https://*.substack.com/*`. Keep the ticket 001 AI-site matches.

**background.js** becomes a thin proxy: take `{type: "REWRITE", payload}` from
the content script, `fetch` `http://127.0.0.1:8787/rewrite`, return the
result. If the fetch throws `Failed to fetch`, the server is not running —
return "PromptBoost server isn't running. Start it with: node
server/server.js" rather than a raw network error.

**content.js — context extraction.** Add a per-surface resolver returning
`{text, context, surface}`:

| Surface | `text` | `context` |
|---|---|---|
| Gmail (`mail.google.com`) | compose box (`[role="textbox"][contenteditable]`) | visible thread body, last ~3 messages, capped 4000 chars |
| Substack | the editor contenteditable | post title plus preceding paragraphs, capped 4000 chars |
| AI chat sites | the prompt box | last few visible turns, capped 4000 chars |
| anything else | active field or selection | empty |

If there is an active **text selection**, that selection is `text` and the
whole field becomes `context`. Selection wins over field contents.

Cap `context` at 4000 characters, truncating from the **start** — keep what is
nearest the cursor, it is the most relevant.

Keep everything that already works: `mousedown` not `click`, the native
`value` setter plus `input` event for React inputs,
`execCommand("insertText")` for contenteditable, the `WeakMap` re-entry
guard, and the `MutationObserver`.

**Mode picker.** With no settings page, the button gets a small adjacent caret
opening a two-item menu (Simple / Structured). Persist the last choice in
`chrome.storage.local` — a preference, not a secret.

## Google Docs

**Not in this ticket.** Google Docs renders document text to `<canvas>`, so
the text is not in the DOM and neither scraping nor insertion works the usual
way. It likely needs a different mechanism (clipboard round-trip, or the Docs
API with OAuth). Do not attempt a partial hack — open ticket 006 to
investigate and report what is actually feasible.

## Acceptance criteria

- [ ] `node server/server.js` with no `config.json` prints a clear setup
      message and exits non-zero
- [ ] With a valid config it boots and prints provider/model/port, never the key
- [ ] `curl -s localhost:8787/health` returns ok
- [ ] `curl -X POST localhost:8787/rewrite -d '{"text":"hi"}'` **without** a
      `chrome-extension://` Origin returns **403**
- [ ] `grep -ri "sk-ant\|apiKey" extension/` returns nothing
- [ ] Extension manifest has no `api.anthropic.com` / `api.openai.com` host
      permission
- [ ] With the server stopped, clicking Enhance shows the "server isn't
      running" message, not a raw network error
- [ ] On Gmail the rewrite reflects the thread — verify by replying to a
      message about a specific topic and checking the output references it

## Open questions

None blocking. If Gmail's compose box resists `execCommand("insertText")`,
report what you observed rather than adding a Gmail-specific hack.
