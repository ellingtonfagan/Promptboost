# Contributing

PromptBoost uses a spec-first loop. Open or update a ticket in `docs/codex-backlog/` before writing code, then reference that ticket in the PR.

## Ticket format

Copy the shape of `docs/codex-backlog/003-local-bridge-server.md`: goal, non-goals, file-level changes, acceptance criteria, and open questions. Product decisions belong in the ticket before implementation starts.

## Local setup

1. Copy `server/config.example.json` to `server/config.json`.
2. Add your provider key and model to `server/config.json`.
3. Start the bridge with `node server/server.js`.
4. Load the unpacked extension from `extension/` in `chrome://extensions`.

## Constraints

- Manifest V3 only.
- Vanilla JavaScript only.
- No build step.
- No npm dependencies.
- Minimal permissions.
- The API key must never enter a page context, content script, URL, telemetry endpoint, or any request except the user's chosen provider call from the local server.

If a change needs broader permissions or moves key handling into the extension, stop and write down the security tradeoff before implementation.

## Testing

Most changes can be checked without spending provider credit:

- Run `node --check` on changed JavaScript files.
- Validate changed JSON files parse.
- Start the server with `server/config.example.json` copied to `server/config.json` and call `curl -s http://127.0.0.1:8787/health`.

For browser behavior, load the unpacked extension, inspect the service worker from `chrome://extensions`, and check the server terminal for bridge errors. Never include API keys or personal email content in issues, PRs, screenshots, or logs.
