# Security

PromptBoost is local-first, but it still handles an API key and may process private writing. Read this before installing it on work email or sensitive accounts.

## Threat model

The bridge server binds to `127.0.0.1`, not `0.0.0.0`, so other machines on your network cannot reach it.

It also refuses rewrite requests unless the request `Origin` starts with `chrome-extension://`. Both controls matter. Binding to localhost keeps remote machines out; the origin gate keeps ordinary websites you visit from calling the local server in your browser and spending your provider credit.

## What the extension can reach

The extension `host_permissions` entry is only:

```json
["http://127.0.0.1:8787/*"]
```

It cannot contact Anthropic, OpenAI, or any other host from the browser extension. You can verify this in `extension/manifest.json`.

## Key handling

Your provider key lives only in `server/config.json`, which is gitignored. The server reads it once at startup and never logs it.

If you ever commit a real provider key, revoke it immediately and create a replacement at `console.anthropic.com`.

## Gmail content

When PromptBoost reviews or rewrites Gmail, your draft text and relevant Gmail thread context are sent to your chosen provider. That context is used so the rewrite can match the conversation, but it may include private or work email content.

Do not install PromptBoost for accounts where sending that text to your provider would violate your employer's policy, client obligations, or personal privacy expectations.

## Reporting

For non-sensitive reports, open a GitHub issue.

For anything exploitable or involving private data, email `<your-email>` instead of filing publicly.

<!-- Ellington: replace <your-email> with the right security contact before public launch. -->
