# 009 — Prepare the repo for public release

**Status:** `ready` — implement after [008](008-inline-underlines.md) lands.

## Goal

Everything a stranger needs to understand, trust, install, and contribute to
this project on GitHub. The code works; this ticket is the packaging.

GitHub owner is `ellingtonfagan`. Assume the repo will live at
`github.com/ellingtonfagan/promptboost`.

## Non-goals

- Publishing to the Chrome Web Store
- Creating the GitHub repo or pushing. Ellington does that.
- Any change to `extension/` or `server/` behavior. This ticket adds docs and
  CI only. If you find a bug, write a ticket, don't fix it here.

## Files to create

### `LICENSE`

MIT, copyright `2026 Ellington Fagan`. Standard text, unmodified.

### `README.md` — rewrite the existing one

This is the page people judge the project by. Structure:

1. **One-sentence description**, then one paragraph on what problem it solves.
2. **A "what it looks like" section.** Reference `docs/images/gmail.png` and
   `docs/images/chat.png` with markdown image syntax. Create
   `docs/images/.gitkeep` and note in the README source (HTML comment) that
   Ellington needs to drop real screenshots in. Do not generate fake
   screenshots.
3. **Status table** — be honest, this is the section that earns trust:

   | Surface | State |
   |---|---|
   | Gmail | Grammar review, inline underlines, Good/Better rewrites |
   | Substack | Prose tightening |
   | Claude / ChatGPT / Cursor / Bolt / Lovable / v0 / Replit | Prompt rewriting |
   | Google Docs | Not supported — see ticket 006 |

4. **Install** — condensed from `DEPLOY.md`, linking to it for detail.
5. **Architecture** — the two-process design and *why*: the key lives in a
   local config file, the extension is permitted to reach `127.0.0.1` and
   nothing else, so a compromised page has no key to steal.
6. **Cost** — it calls the user's own Anthropic account. Note that Gmail
   auto-checks after a 3s typing pause, list the cost guards from ticket 008,
   and say plainly that heavy use costs money.
7. **Development** — the spec-first workflow: tickets in
   `docs/codex-backlog/`, `AGENTS.md` as the agent brief.
8. **License** — MIT, link the file.

Keep the existing README's closing note about this being an independent
implementation in the category.

### `SECURITY.md`

The project holds an API key, so this matters more than boilerplate:

- **Threat model.** The server binds `127.0.0.1` and refuses any request whose
  `Origin` is not `chrome-extension://`. Explain why both are needed: without
  the origin gate, any page you visit could call the server and spend your
  credit.
- **What the extension can reach.** `host_permissions` is
  `http://127.0.0.1:8787/*` only. It cannot contact Anthropic, OpenAI, or any
  other host. State that this is verifiable in `extension/manifest.json`.
- **Key handling.** Key lives only in `server/config.json`, gitignored, read
  once at startup, never logged. Tell users to revoke and rotate at
  console.anthropic.com if they ever commit one.
- **Gmail content.** Draft text and thread context are sent to the user's
  chosen provider. Say so explicitly — anyone using this on work email needs
  to know that before installing.
- **Reporting.** Open a GitHub issue for non-sensitive reports; for anything
  exploitable, email rather than filing publicly. Use a placeholder
  `<your-email>` and note in an HTML comment that Ellington should fill it in.

### `CONTRIBUTING.md`

- The spec-first loop: open a ticket in `docs/codex-backlog/` before writing
  code; PRs reference their ticket.
- Ticket format, pointing at `003` as the model to copy.
- Local setup: copy `config.example.json`, `node server/server.js`, load
  unpacked from `extension/`.
- The hard constraints from `AGENTS.md`: MV3, vanilla JS, no build step, no
  npm dependencies, minimal permissions, and the rule that the API key never
  enters a page context.
- How to test without burning credit: point at `server/config.example.json`
  and note that most changes can be checked with `node --check` plus a
  `/health` call.

### `.github/workflows/ci.yml`

GitHub Actions, runs on push and PR. No dependencies to install:

- `node --check` every `.js` file under `extension/` and `server/`
- Validate every `.json` file parses
- **Secret scan:** fail the build if an Anthropic or OpenAI project secret
  prefix appears anywhere in the tree. This is the one that matters — it
  catches a committed key before it reaches a public repo.
- Assert `extension/manifest.json` `host_permissions` contains no
  `anthropic.com` or `openai.com` entry.

Use `actions/checkout@v4` and `actions/setup-node@v4` with Node 20.

### `.github/ISSUE_TEMPLATE/bug_report.md`

Fields that make bugs actionable here: which surface (Gmail / Substack /
chat site), whether the server was running, what
`chrome://extensions` → Inspect service worker showed, and what the server
terminal printed. Ask explicitly for **no API keys in the report**.

### `.github/ISSUE_TEMPLATE/feature_request.md`

Short. Which surface, what problem it solves, and whether it fits the scope
constraints in `AGENTS.md`.

### `.github/pull_request_template.md`

Which ticket this implements, what was verified by hand (the browser criteria
CI cannot check), and a checkbox confirming no key or personal email content
is included in the diff.

## Acceptance criteria

- [ ] The CI secret scan fails if a provider secret prefix appears anywhere in
      the tree
- [ ] Every file above exists and is non-empty
- [ ] `README.md` status table lists Google Docs as unsupported
- [ ] `SECURITY.md` states that draft and thread text is sent to the provider
- [ ] CI workflow is valid YAML and its secret-scan step would fail on a
      planted fake provider-secret string — verify by planting one in a temp file,
      running the grep the workflow uses, confirming it exits non-zero, then
      deleting the temp file
- [ ] No file under `extension/` or `server/` is modified by this ticket

## Open questions

None. If a licensing question arises, stop and flag it rather than choosing a
different license.
