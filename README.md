# PromptBoost

PromptBoost is a local-first Chrome extension that improves drafts, email replies, essays, and AI-coding prompts in the text box where you are already writing.

It is for the moment when the thought is right but the wording is rough: a Gmail reply that needs to be clearer, a Substack paragraph that needs tightening, or a coding prompt that needs enough structure for an agent to execute. PromptBoost keeps the browser extension thin and sends provider calls through a local server you run on your own machine.

## What it looks like

![PromptBoost in Gmail](docs/images/gmail.png)

![PromptBoost on a chat surface](docs/images/chat.png)

<!-- Real screenshots are needed before public launch. Drop them at docs/images/gmail.png and docs/images/chat.png. -->

## Status

| Surface | State |
|---|---|
| Gmail | Grammar review, inline underlines, Good/Better rewrites |
| Substack | Prose tightening |
| Claude / ChatGPT / Cursor / Bolt / Lovable / v0 / Replit | Prompt rewriting |
| Google Docs | Not supported — see ticket 006 |

## Install

See [DEPLOY.md](DEPLOY.md) for the full walkthrough.

Short version:

1. Copy `server/config.example.json` to `server/config.json`.
2. Add your Anthropic API key and chosen model to `server/config.json`.
3. Start the bridge with `node server/server.js`.
4. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension/` folder.

There is no build step and no npm install.

## Architecture

PromptBoost has two processes:

| Piece | Job |
|---|---|
| `extension/` | Finds editable fields, shows the Enhance UI, extracts nearby context, and talks only to the local bridge |
| `server/` | Reads `server/config.json` once at startup and makes the provider request |

The split is deliberate. The API key lives in a local config file, not in a content script or page context. The extension is permitted to reach `http://127.0.0.1:8787/*` and nothing else, so a compromised web page has no provider key to steal and no extension permission to call Anthropic or OpenAI directly.

The local server also rejects rewrite requests unless the browser sends a `chrome-extension://` origin. Without that origin gate, any page you visit could try to call your localhost server and spend your credit.

## Cost

PromptBoost calls your own Anthropic account. Heavy use costs money.

Gmail review is the only automatic check today: after you stop typing for 3 seconds, PromptBoost can ask the provider for grammar and rewrite suggestions. The cost guards from ticket 008 are part of that behavior:

- It skips unchanged text.
- It ignores drafts under 25 characters.
- It allows only one review request in flight per field.
- It aborts superseded requests when the text changes.

Manual Enhance clicks send a request immediately.

## Development

Work is spec-first. Tickets live in `docs/codex-backlog/`, and each code change should reference the ticket it implements. `AGENTS.md` is the standing brief for implementation agents: Manifest V3, vanilla JS, no build step, minimal permissions, and no API key in a page context.

## License

MIT. See [LICENSE](LICENSE).

## Prior art, and what this isn't

The category — in-place prompt rewriting for AI coding tools — has commercial players. This is an independent implementation: its own prompts, its own UI, its own code. Nothing here was extracted from, decompiled from, or copied out of another product.
