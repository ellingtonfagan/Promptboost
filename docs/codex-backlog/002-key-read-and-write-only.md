# 002 — Fix key never reaching the worker; make the key write-only

**Status:** `done` — implemented by Claude directly, not Codex. This was a
one-line blocking bug found during first real Chrome load; writing the ticket
after the fix to keep the trail rather than to gate it.

## Bug

`background.js` never received the API key. `chrome.storage.local.get(obj)`
returns **only the keys present in `obj`**, and `DEFAULTS` in `background.js`
listed `provider`, `model`, `mode` — but not `apiKey`. So `settings.apiKey`
was always `undefined` and every rewrite failed the `if (!key)` guard with
"Add your API key in PromptBoost settings," no matter what was saved.

`options.js` had `apiKey: ""` in its own defaults, so the settings page read
the key back correctly. That mismatch is what made it look like saving worked
while the extension behaved as if no key existed.

Ticket 001's acceptance criteria could not have caught this: "no key set shows
a message" passes, and the case that fails needs a real browser and a real
key.

**Fix:** add `apiKey: ""` to `DEFAULTS` in `background.js`.

## Change 2 — the key is write-only in the UI

Requested by Ellington: once a key is saved, the extension must never render
it back on screen.

- `options.js` no longer populates `#api-key` from storage. The field is
  always empty on open.
- The **Show/Hide** toggle is removed entirely, along with `#toggle-key` in
  `options.html` and its handler. Nothing in the UI can reveal a stored key.
- A status line reports only whether a key exists — "A key is saved." /
  "No key saved yet." — never any characters of the key itself, not even a
  masked suffix.
- On save, `apiKey` is written **only if the field is non-empty**. This is
  load-bearing: without it, changing the model or mode would blank the stored
  key, since the field now starts empty every time.
- Placeholder text changes to "Paste a key to replace the saved one" when a
  key exists.

The key remains readable to the extension itself (the service worker must send
it to the provider). This change removes it from the *display* surface, not
from storage.

## Acceptance criteria

- [x] `background.js` `DEFAULTS` contains `apiKey`
- [x] No `#toggle-key` element or handler remains
- [x] `options.js` never assigns a stored key to `keyInput.value`
- [x] Saving with an empty key field preserves the existing stored key
- [ ] Verified in Chrome with a live key — **Ellington to confirm**
