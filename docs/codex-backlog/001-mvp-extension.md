# 001 — MVP extension: in-place prompt rewriting

**Status:** `ready` — implement this.

## Goal

A working Manifest V3 Chrome extension that injects an "✨ Enhance" button
near the prompt box on supported AI coding sites. Clicking it sends the
current draft to the user's own LLM provider and replaces the text in place
with a rewritten version.

The whole value is **in place**: no new tab, no copy/paste, no "open
PromptBoost." Type → click → better prompt, in the box you were already
typing in.

## Non-goals (do not build these)

- Prompt history / saved prompts
- User-editable prompt templates (the two templates are constants for now)
- Any backend, account system, or hosted proxy
- Analytics or telemetry of any kind
- A framework, bundler, or npm dependency

## Files to create

```
manifest.json
background.js
content.js
content.css
options.html
options.js
icons/icon16.png  icons/icon48.png  icons/icon128.png
```

## manifest.json

- `manifest_version: 3`
- `name`: "PromptBoost", `version`: "0.1.0"
- `permissions`: `["storage"]` — nothing else
- `host_permissions`: `["https://api.anthropic.com/*", "https://api.openai.com/*"]`
- `background`: `{ "service_worker": "background.js" }`
- `action`: default popup `options.html`, plus the icons
- `options_page`: `options.html`
- One `content_scripts` entry running `content.js` + `content.css` at
  `document_idle` on:
  - `https://chatgpt.com/*`, `https://chat.openai.com/*`
  - `https://claude.ai/*`
  - `https://cursor.com/*`
  - `https://bolt.new/*`
  - `https://lovable.dev/*`
  - `https://v0.app/*`, `https://v0.dev/*`
  - `https://replit.com/*`

## content.js

**Field detection.** Scan for the likely prompt box: `textarea`,
`[contenteditable="true"]`, and `input[type="text"]` that are visible and at
least 120px wide. Prefer the largest such element that is currently focused
or was most recently focused. Re-scan on a `MutationObserver` watching
`document.body` with `{childList: true, subtree: true}` — these are all SPAs
and the box is created and destroyed as the user navigates.

- The observer callback fires **constantly** on chat sites. Keep it cheap.
- Guard against double-attaching with a `WeakMap<Element, HTMLElement>`
  mapping field → its button. Scanning must be idempotent.

**Button.** A floating element positioned above-right of the field using
`getBoundingClientRect()` + `window.scrollX/scrollY`. Reposition on `input`,
`focus`, `scroll` (capture phase), and `resize`. Show it once the field has
at least 6 characters of text; hide it otherwise.

**Click handling — use `mousedown`, not `click`.** Most of these chat UIs
blur or collapse the composer on blur, and `click` fires *after* blur.
`mousedown` fires before it. Call `preventDefault()` and `stopPropagation()`
so focus never leaves the field.

**Writing text back — this is the part that breaks if done naively.** Setting
`el.value = "..."` on a React-controlled input does **not** trigger React's
`onChange`: React caches the previous value on the DOM node and skips events
it thinks are echoes of its own writes. Go through the native property
setter, then dispatch a real event:

```js
const proto = el instanceof HTMLTextAreaElement
  ? HTMLTextAreaElement.prototype
  : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
setter.call(el, text);
el.dispatchEvent(new Event("input", { bubbles: true }));
```

For `contenteditable` elements, select all and use
`document.execCommand("insertText", false, text)` — deprecated, but still the
most reliable way to trigger the host framework's mutation observer.

**States.** While the request is in flight, disable the button and show a
loading state. On error, show a small toast near the button with the actual
message (not "something went wrong"), and leave the user's original text
untouched.

## background.js

Owns the API key. The content script never sees it.

Listen for `{ type: "REWRITE_PROMPT", text }` via
`chrome.runtime.onMessage`. Read `provider`, `apiKey`, `model`, and `mode`
from `chrome.storage.local` **at call time** — MV3 service workers are killed
after ~30s idle, so never cache settings in module scope. Respond
`{ ok: true, text }` or `{ ok: false, error }`.

Return `true` from the `onMessage` listener so the async `sendResponse` stays
valid.

### Anthropic request

`POST https://api.anthropic.com/v1/messages`

Headers:
```
content-type: application/json
x-api-key: <user key>
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
```

The last header is required — Anthropic blocks browser-origin requests by
default. It is acceptable here only because the key is the user's own and
stays on their machine.

Body:
```json
{
  "model": "<user-selected>",
  "max_tokens": 4096,
  "system": "<mode template>",
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "low" },
  "messages": [{ "role": "user", "content": "<the draft>" }]
}
```

**Do not deviate from these three details** — they are current as of this
ticket and your training data is likely older:

1. Valid model IDs are `claude-opus-5`, `claude-sonnet-5`, and
   `claude-haiku-4-5`. Do **not** append date suffixes. Do not use
   `claude-3-*`, `claude-sonnet-4-*`, or any `claude-*-latest` alias.
2. `thinking` takes `{"type": "adaptive"}`. The old
   `{"type": "enabled", "budget_tokens": N}` form returns a 400 on these
   models. `temperature`, `top_p`, and `top_k` are also rejected — do not
   send them.
3. `effort` goes **inside** `output_config`, not at the top level. Use `low`:
   this is a one-shot rewrite, not a reasoning task.

Leave thinking on. Disabling it on Opus 5 can leak `<thinking>` tags into the
visible response, and that response is written straight into the user's
prompt box.

Parse the reply by filtering `response.content` for blocks with
`type === "text"` and joining their `.text`. Do **not** index `content[0]`
directly — with thinking on, the first block may be a thinking block.

Check `stop_reason === "refusal"` before reading content and surface a clear
message if so.

### OpenAI request

`POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer
<key>`, standard `messages` array with the mode template as a `system`
message. Read the text from `choices[0].message.content`.

The model is a free-text field in settings defaulting to `gpt-4o-mini` — do
not hardcode a list, since these IDs move.

### Error handling

Map HTTP status to a message the user can act on: 401 → "Check your API key",
429 → "Rate limited — wait and retry", 400 → include the provider's own error
message, 5xx → "Provider is having problems, try again." Never swallow an
error into a generic string.

## The two mode templates (constants in background.js)

**`simple`** — one clean paragraph. System prompt, roughly:

> Rewrite the developer's prompt so an AI coding assistant can act on it
> directly. Keep their intent exactly; do not add requirements they did not
> ask for. Make implicit context explicit, name the concrete artifacts
> involved, and state what "done" looks like. Return one focused paragraph
> and nothing else — no preamble, no options, no commentary on the rewrite.

**`structured`** — a four-section brief. System prompt, roughly:

> Rewrite the developer's prompt as an implementation brief with exactly four
> sections: ROLE, OBJECTIVE, SCOPE, PLAN. ROLE names the kind of engineer the
> task calls for. OBJECTIVE states what done looks like in one or two
> sentences. SCOPE lists what the change touches and, where it matters, what
> it must not touch. PLAN gives the ordered steps. Preserve their intent
> exactly; do not invent requirements. Return only the brief.

Both templates must end with an instruction that the output is the rewritten
prompt itself and nothing else — no "Here is the rewritten prompt:" preamble.

## options.html / options.js

One screen, fits without scrolling:

- Provider: radio, Anthropic / OpenAI
- API key: `type="password"` with a show/hide toggle
- Model: a `<select>` for Anthropic (`claude-opus-5` default,
  `claude-sonnet-5`, `claude-haiku-4-5`), a text input for OpenAI
- Mode: radio, Simple / Structured
- Save button with a visible confirmation

Persist to `chrome.storage.local` (not `.sync` — `.sync` has a ~100KB cap and
per-item write rate limits that are easy to trip). Load current values on
open. A fresh install with nothing set must render a clear empty state, not
crash.

## icons/

Three flat PNGs at 16/48/128. A solid rounded square with a "P" or a spark
glyph is fine — this is a placeholder, not a brand.

## Acceptance criteria

- [ ] Loads via Load unpacked with zero errors on the extension card
- [ ] Zero errors in the service worker console on load
- [ ] Button appears near the composer on claude.ai and chatgpt.com, and
      tracks the field on scroll and window resize
- [ ] Clicking with a valid key replaces the text in place, and the host
      page's own send button becomes enabled (proves the React input event
      landed)
- [ ] Clicking with **no** key set shows a readable "add your API key"
      message and leaves the draft untouched
- [ ] An invalid key shows the 401 message, not a generic failure
- [ ] Both modes produce visibly different output shapes
- [ ] `grep -ri "apiKey\|api_key" content.js` returns nothing — the key never
      reaches a page context

## Open questions

None blocking. If the composer on a specific site resists the native-setter
trick, note which site and what you observed in the PR rather than adding
site-specific hacks — that's a follow-up ticket, not part of this one.
