# Running PromptBoost

Two pieces: a **local server** that holds your API key, and a **Chrome
extension** that holds nothing. The extension talks only to `127.0.0.1` — it
cannot reach Anthropic or anyone else, by permission.

You enter your API key exactly once, in a file. Never again.

---

## One-time setup

### 1. Put your key in the config

```bash
cd ~/Documents/promptboost
cp server/config.example.json server/config.json
open -e server/config.json
```

Paste your key between the quotes on the `apiKey` line and save. Get one at
[console.anthropic.com](https://console.anthropic.com) → Settings → API keys
→ Create. It is shown once. Add a few dollars of credit under Billing.

`server/config.json` is gitignored — it will never be committed.

Model options: `claude-sonnet-5` (good default), `claude-opus-5` (best,
pricier), `claude-haiku-4-5` (cheapest, fastest).

### 2. Load the extension

1. `chrome://extensions`
2. **Developer mode** on, top right
3. **Load unpacked**
4. Press **⌘⇧G**, paste `/Users/ellingtonfagan/Documents/promptboost/extension`
   — note the `/extension` on the end; loading the repo root will fail
5. Pin it via the puzzle-piece icon

There is no settings screen and nothing to configure. That's the point.

---

## Every time you want to use it

Start the server:

```bash
cd ~/Documents/promptboost && node server/server.js
```

Leave that terminal open. You should see:

```
PromptBoost bridge listening on http://127.0.0.1:8787
```

Stop it with `Ctrl+C`. Making it start automatically at login is ticket 005.

---

## Using it

Go to Gmail, Substack, claude.ai, ChatGPT, Cursor, Bolt, Lovable, v0, or
Replit. Type or select some text. An **✨ Enhance** button appears — click it,
and the text is replaced in place.

The caret next to the button switches between **Simple** and **Structured**.

**It reads context.** In Gmail it sends the thread you're replying to, so the
rewrite knows who you're talking to and what they said. On Substack it sends
the surrounding post. On chat sites it sends recent turns. If you *select*
text, only the selection gets rewritten and the rest of the field becomes
context.

Google Docs is **not** supported — Docs draws its text on a `<canvas>`, so the
text isn't in the page for an extension to read or replace. See ticket 006.

---

## When something breaks

**"PromptBoost server isn't running."**
Exactly what it says. Start it (above). This is the most common one.

**Button appears but nothing happens.**
`chrome://extensions` → **Inspect service worker** to see the request. Also
check the terminal running the server — provider errors print there.

**"Check your API key" / 401.**
Wrong key, revoked key, or no credit on the account. Re-copy it into
`server/config.json` and restart the server — config is read once at startup,
so edits need a restart.

**Button never appears.**
Reload the page. Content scripts don't apply to tabs that were already open
when you loaded or reloaded the extension.

---

## Why it's built this way

The key lives in one file on your disk that only the server reads. The
extension is permitted to reach `127.0.0.1:8787` and nothing else — so even
if a page compromised it, there's no key to steal and nowhere to send it.

The server refuses any request that doesn't come from a `chrome-extension://`
origin, so a random website you visit can't quietly call it and spend your
credits. It binds to `127.0.0.1`, so nothing off this machine can reach it at
all. Both are tested in `docs/codex-backlog/003-local-bridge-server.md`.
