# AGENTS.md — instructions for coding agents (Codex) working in this repo

You are the implementation agent on this project. A separate planning agent
(Claude, via Anthropic) writes specs and reviews your work. This file is your
persistent brief — read it before starting any task.

## What this project is

PromptBoost — a Chrome extension (Manifest V3) that adds an "Enhance" button
next to the prompt box on AI coding sites. The user types a vague prompt, hits
the button, and the text is replaced in place with a clearer, more
implementation-ready version.

**The one rule that overrides everything else in this repo:** the user's API
key is theirs. It is read from `chrome.storage.local`, used only in
`background.js` to call the provider the user chose, and sent nowhere else.
No telemetry endpoint, no analytics, no "phone home for updates," and the key
must never be readable from a page context. If a task would put the key in a
content script, in a URL, or in a request to any host other than the user's
chosen provider, stop and flag it instead of implementing it.

## How work reaches you

Work is defined as **tickets** under `docs/codex-backlog/NNN-slug.md`. Each
ticket is a complete, scoped spec: goal, non-goals, file-level changes,
acceptance criteria. Always implement from a ticket.

- If asked to do something with no matching ticket, write one first (copy the
  format from an existing ticket), commit it alongside your change, and
  reference it. This keeps a written trail the planning agent can review.
- If a ticket is ambiguous on a **product** decision (which model tier, UX
  copy, pricing, which sites to support) — don't guess. Fill in the ticket's
  "Open questions" section, implement the parts that aren't blocked, and say
  clearly what's blocked and why.

## Hard constraints

- **Manifest V3.** No `background.page`, no persistent background script.
- **No build step. No bundler. No npm dependencies.** Vanilla JS only, loaded
  directly by the browser. If you find yourself wanting a framework for a
  button and a fetch call, that's the signal to stop. This is deliberate —
  the content script runs on every page load of every supported site.
- **No remote code loading.** MV3 CSP forbids it and so do we. Everything
  ships in the package.
- **Permissions stay minimal.** `storage` only, plus `host_permissions` for
  the two API hosts. Do NOT add `host_permissions` for the AI coding sites —
  content scripts get access via `content_scripts.matches` instead. Broader
  permissions make the install prompt scarier for no benefit.

## Verification

There is no test runner in this repo yet (see ticket 002). Until there is,
verify by hand before declaring a ticket done:

1. `chrome://extensions` → Developer mode → Load unpacked → select this repo.
2. Confirm zero errors on the extension card and zero errors in the service
   worker console (`Inspect service worker`).
3. Open `https://claude.ai` and `https://chatgpt.com`, confirm the button
   appears near the prompt box and follows it on resize/scroll.
4. With no API key set, confirm the button surfaces a clear "add your API key"
   message rather than failing silently or throwing.

Report what you actually verified. If you could not verify something, say so
plainly rather than implying it passed.

## Repo map

```
manifest.json      # MV3 manifest — permissions, matched sites, entry points
background.js      # service worker: owns the API key and all provider calls
content.js         # DOM detection, button injection, text swap
content.css        # button + toast styling (injected into host pages)
options.html       # settings UI markup
options.js         # settings UI logic — reads/writes chrome.storage.local
icons/             # 16 / 48 / 128 px PNGs
docs/codex-backlog/ # tickets — the contract for every change
```

## Style

- Vanilla ES2022. `const`/`let`, no `var`. Async/await over `.then()` chains.
- Keep comments to the ones that state a constraint the code can't show. Do
  not narrate what the next line does.
- No dead code, no commented-out blocks, no "future-proofing" abstractions for
  features that aren't in a ticket.
