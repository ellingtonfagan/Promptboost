# 006 — Investigate Google Docs support

**Status:** `draft` — investigate before implementing.

## Goal

Determine whether PromptBoost can safely support Google Docs and identify the
least fragile mechanism for reading selected document text, collecting useful
context, and writing rewritten text back in place.

## Why

Google Docs does not expose normal document text as ordinary editable DOM.
Much of the document is rendered through canvas-backed surfaces, so the
content-script strategy used for chat sites, Gmail, and Substack is unlikely
to work reliably.

## Questions to answer

- Can a content script reliably detect selected Google Docs text without
  scraping canvas-rendered content?
- Can replacement be done through a clipboard round trip without surprising
  the user or damaging formatting?
- Would Google Docs API access with OAuth be required, and if so what
  permissions would the extension need?
- What context can be collected safely without broad Drive or Docs access?

## Non-goals

- Do not add Google Docs content-script matches yet.
- Do not request OAuth permissions yet.
- Do not add a partial DOM scraping workaround.

## Acceptance criteria

- [ ] Report which mechanisms were tested
- [ ] Document the permissions required for any viable approach
- [ ] Recommend whether Google Docs should be supported in the extension,
      through a separate integration, or not at all
