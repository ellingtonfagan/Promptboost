# 007 — Gmail: grammar review with Good / Better options

**Status:** `ready` — implement this.

Extends [003](003-local-bridge-server.md). Does not change `/rewrite`, which
other surfaces still use.

## Goal

On Gmail, clicking Enhance should stop silently replacing the draft. Instead
it opens a panel showing what is actually wrong with the text and two rewrite
options at different levels of intervention, and the user applies one.

The mental model is Grammarly: see the problems, choose the fix. The
difference is that we show issues in a panel rather than as inline underlines
— see "Why not inline underlines" below.

## Non-goals

- Inline underlines or any decoration injected into the compose DOM
- Real-time checking as the user types. This is on-click only.
- Changing behavior on Substack, chat sites, or generic surfaces
- A grammar library or dictionary dependency. The model does this.

## Part 1 — server: `POST /review`

New endpoint alongside `/rewrite`. Same origin gate, same 100KB body cap, same
config. Body:

```json
{
  "text": "the draft (required)",
  "context": "thread context (optional)",
  "surface": "gmail"
}
```

Response:

```json
{
  "ok": true,
  "review": {
    "issues": [
      {"type": "grammar", "quote": "their going", "fix": "they're going", "why": "possessive vs contraction"}
    ],
    "good": "the draft with errors corrected, voice untouched",
    "better": "the draft rewritten for clarity and tone"
  }
}
```

**Use structured outputs — do not parse prose.** Set `output_config.format`
to a `json_schema` so the model must return this shape:

```js
output_config: {
  effort: "low",
  format: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["grammar", "spelling", "punctuation", "clarity", "tone"] },
              quote: { type: "string" },
              fix:   { type: "string" },
              why:   { type: "string" }
            },
            required: ["type", "quote", "fix", "why"],
            additionalProperties: false
          }
        },
        good:   { type: "string" },
        better: { type: "string" }
      },
      required: ["issues", "good", "better"],
      additionalProperties: false
    }
  }
}
```

`effort` and `format` are siblings inside `output_config`. Keep
`thinking: {"type": "adaptive"}`. Everything else about the Anthropic call is
unchanged from ticket 003 — same headers, same model IDs, no
`temperature`/`top_p`/`top_k`/`budget_tokens`.

With `format` set, the first text block is valid JSON — still collect text
blocks by filtering on `type === "text"` (a thinking block can precede them),
then `JSON.parse` the joined result. If parsing fails, return
`{ok: false, error: "..."}` rather than throwing.

**System prompt for `/review`.** It must say, in substance:

> You are reviewing an email draft. Report every grammar, spelling, and
> punctuation error you find, quoting the exact text and giving the
> correction. Then produce two versions. `good` fixes only errors and leaves
> the writer's voice, structure, and word choice alone — it is the draft, made
> correct. `better` rewrites for clarity, concision, and an appropriate tone
> for the thread, and may restructure. Preserve every commitment, date, name,
> and number exactly in both. Invent nothing. If the draft has no errors,
> return an empty issues array — do not manufacture problems to seem useful.

That last sentence is load-bearing. Without it the model will always find
something, and a tool that flags non-errors is worse than no tool.

`quote` must be text that appears **verbatim** in the draft, so the UI can
locate it. Say so in the prompt.

## Part 2 — extension: the panel

On Gmail only, Enhance calls `/review` and renders a panel anchored near the
compose box. Everywhere else, behavior is unchanged.

Panel contents, in this order:

1. **Issues** — one row each: the quoted text, an arrow, the fix, and the
   `why` in smaller muted text. Group by `type`. If `issues` is empty, show
   "No grammar or spelling issues found." and nothing else in this section.
2. **Good** — the corrected draft, with an **Apply** button.
3. **Better** — the rewritten draft, with an **Apply** button.

Both Apply buttons write into the compose box using the existing
`execCommand("insertText")` path from ticket 003 and then close the panel.
A **Dismiss** button closes without changing anything.

Panel requirements:
- Rendered in a container appended to `document.body`, positioned near the
  compose box — **not** inside the compose element. Nothing this code creates
  may ever end up in the sent email.
- Dismiss on `Escape` and on click outside.
- Reposition on scroll and resize, same approach as the button.
- Constrain height and scroll internally; a long draft must not produce a
  panel taller than the viewport.
- Keep the existing `WeakMap` guard so repeated clicks don't stack panels.

Styling goes in `content.css`. Prefix every class with `promptboost-` — Gmail
has an enormous global stylesheet and unprefixed names will collide.

## Why not inline underlines

Grammarly's underlines require injecting markup into the compose
`contenteditable`. Gmail continuously rewrites that DOM as it autosaves
drafts, so decorations are both fragile and at risk of being serialized into
the sent message. A panel conveys the same information with no chance of
mangling the email. If inline marking is wanted later it needs its own ticket
and a real answer for the autosave problem.

## Acceptance criteria

- [ ] `POST /review` without a `chrome-extension://` Origin returns 403
- [ ] A draft with deliberate errors ("their going too the meeting") returns
      issues whose `quote` values appear verbatim in the input
- [ ] A clean, correct draft returns `issues: []` and does not invent problems
- [ ] `good` preserves the writer's phrasing; `better` may restructure — they
      are visibly different
- [ ] Both preserve dates, names, and numbers from the draft exactly
- [ ] Apply writes into the compose box and closes the panel
- [ ] Escape and outside-click both dismiss without modifying the draft
- [ ] No element created by this ticket is ever a descendant of the compose
      box — verify by inspecting the DOM after applying
- [ ] Substack and chat surfaces still use `/rewrite` and are unchanged

## Open questions

None blocking. If Gmail's compose box proves to have multiple matching
`[contenteditable]` nodes (it sometimes does for signatures and quoted text),
report which one you targeted and how you disambiguated.
