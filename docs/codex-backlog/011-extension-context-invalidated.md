# 011 — Guard against extension context invalidation

**Status:** `done` — implemented directly; blocking bug found in real Gmail use.

## Bug

`Cannot read properties of undefined (reading 'sendMessage')` in Gmail.

When the extension is reloaded or updated, `chrome.runtime` becomes
`undefined` in content scripts of pages that were already open. All four
`chrome.runtime.sendMessage` call sites in `content.js` were unguarded.

The 3s auto-review from [008](008-inline-underlines.md) made this much worse
than a one-off error: an orphaned content script keeps firing its debounce
timer on every keystroke, throwing an uncaught error each time. The user sees
a console flood, not a single failure.

## Fix

- `isExtensionAlive()` — checks `chrome?.runtime?.id` inside a try/catch,
  since even property access can throw once the context is gone.
- `sendToWorker()` — the single guarded path for all worker messages. Returns
  `null` when the extension is gone, and also catches the
  "Extension context invalidated" rejection that can occur between the check
  and the call.
- `handleExtensionGone()` — fires once, clears every debounce timer, aborts
  in-flight requests, clears all markers, and shows
  "PromptBoost was updated. Reload this page to keep using it."
- Fire-and-forget `ABORT_REQUEST` calls wrapped so they cannot throw.
- The rewrite caller returns early on `null` rather than throwing a generic
  "Prompt rewrite failed", which would have replaced the useful message with
  a worse one.

## Acceptance criteria

- [x] No unguarded `chrome.runtime.sendMessage` remains
- [x] `node --check` passes
- [ ] Reloading the extension with Gmail open shows the reload message once,
      and typing afterwards produces no console errors — **Ellington to verify**
