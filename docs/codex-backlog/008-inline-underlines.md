# 008 — Inline colored underlines on Gmail (overlay, not injection)

**Status:** `ready` — implement after [007](007-gmail-review-panel.md) lands.

Ellington wants Grammarly-style inline underlines. Ticket 007 deliberately
avoided them because injecting markup into Gmail's compose `contenteditable`
risks it being serialized into the sent email. This ticket delivers the
underlines while keeping that guarantee, by **never touching the compose DOM**.

## The technique

Draw the underlines in a separate overlay element positioned on top of the
compose box. For each issue, locate its `quote` in the compose box's text
nodes, build a `Range` over it, and call `range.getClientRects()` — that
returns one rect per visual line the range covers, so wrapped text works
correctly. Paint one absolutely-positioned marker per rect in the overlay.

**The compose element is never mutated.** No wrapper elements, no injected
markup, nothing for Gmail's autosave to serialize. The only time the compose
content changes is when the user explicitly accepts a fix.

## Non-goals

- Checking on every keystroke. See "Auto-trigger" — it fires on idle, not
  continuously.
- Underlines on Substack or the chat surfaces. Gmail only.
- Any modification of compose DOM structure for decoration purposes. If a
  proposed approach requires wrapping text in elements, it is the wrong
  approach — stop and flag it.

## Auto-trigger — check 3s after typing stops

The underlines should appear on their own, not only after clicking Enhance.

Debounce on the compose box's `input` event: every keystroke clears all
markers and resets a **3000ms** timer. When the timer fires, run `/review`
and paint the underlines. A keystroke during those 3 seconds cancels the
pending run — that is the whole point of the debounce.

**Cost guards. These are not optional.** Auto-firing spends the user's API
credit without them asking, so every one of these must be in place:

1. **Skip unchanged text.** Keep the exact string last sent for review. If the
   current text is identical, do not call the server. Typing a character and
   deleting it must not trigger a call.
2. **Minimum length: 25 characters.** Below that, do nothing. Nobody needs a
   grammar check on "ok thanks".
3. **One request in flight per field.** If a review is already running, do not
   start another — let the running one finish, and only re-run afterward if
   the text changed while it was out.
4. **Abort superseded requests.** Use an `AbortController` and abort the
   in-flight fetch if the text changes before it returns. A response for text
   the user has already edited is stale and must never paint markers.

**Status indicator.** While a review is in flight, show a small unobtrusive
"Checking…" state on the Enhance button — not a modal, not a toast. The user
should be able to ignore it entirely and keep typing.

**The manual button still works.** Clicking Enhance runs the review
immediately, bypassing the debounce, and additionally opens the 007 panel
with Good/Better. The auto-trigger paints underlines only — it must **not**
pop the panel open while someone is typing.

## Overlay construction

- One container `div.promptboost-underlay` appended to `document.body`,
  `position: absolute`, `pointer-events: none`, `z-index` above Gmail's
  compose chrome but below the 007 panel.
- Position and size it to the compose box's `getBoundingClientRect()` plus
  scroll offsets.
- Each marker is a child `div.promptboost-mark` with `position: absolute`,
  a `border-bottom: 2px solid`, and `pointer-events: auto` so it is clickable
  even though the container is not. Markers must not capture typing — only
  the marker rectangles themselves are interactive, and they sit under the
  text baseline.

**Colors by issue type:**

| Type | Color |
|---|---|
| `grammar`, `spelling`, `punctuation` | red (`#d93025`) |
| `clarity`, `tone` | blue (`#1a73e8`) |

Use a wavy underline where supported (`text-decoration: wavy` is not usable
on an empty div, so use `border-bottom` with a repeating linear-gradient
background, or a 2px solid border as the fallback). A solid 2px border is
acceptable if the gradient proves unreliable — do not spend long on this.

## Locating each quote

Walk the compose box's text nodes with a `TreeWalker` (`SHOW_TEXT`),
concatenating into a single string while recording each node's start offset.
Then:

1. Find `quote` in the concatenated string with `indexOf`.
2. **Track consumed positions.** If the same quote appears more than once,
   each issue consumes the next unclaimed occurrence — do not underline the
   same span twice.
3. Map the string index back to `(node, offset)` pairs and build the `Range`.
4. If the quote is **not** found verbatim, skip that issue silently. Do not
   throw, and do not fall back to fuzzy matching — a mispositioned underline
   is worse than a missing one.

**Skip Gmail's quoted-reply section.** Gmail nests the prior thread inside the
compose area (`.gmail_quote`, `blockquote`). Exclude those subtrees from the
TreeWalker, or every quote from the thread will get underlined.

## Interaction

- **Click a marker** → small popover anchored to it, showing the `fix` and
  the `why`, with **Accept** and **Ignore** buttons.
- **Accept** → select that `Range` and replace it via
  `execCommand("insertText", false, fix)`. This is the one sanctioned compose
  mutation and it inserts plain text only. Then remove that marker and
  reposition the rest, since offsets after the edit have shifted.
- **Ignore** → remove just that marker.
- **Hover** → tooltip with the fix, no click required.

## Invalidation — this is where it will break if rushed

Decorations go stale the moment the text changes. Handle all of:

- Any `input` event on the compose box that PromptBoost did not itself cause
  → clear every marker. Stale underlines pointing at moved text are the worst
  possible outcome.
- `scroll` (capture phase) and `resize` → recompute rects and reposition.
- Compose box closed or removed → tear down the overlay and disconnect
  observers. Do not leak overlays across Gmail's SPA navigation.
- Accepting one fix shifts the offsets of every later issue → recompute all
  remaining ranges from the current DOM after each accept, rather than
  reusing stale Range objects.

## Relationship to ticket 007

The 007 panel stays. Underlines handle per-error fixes; the panel keeps the
whole-draft **Good** and **Better** options and the issue list. Both are fed
by the same single `/review` call — do not call the server twice.

Applying Good or Better from the panel replaces the whole draft, so it must
clear all markers.

## Acceptance criteria

- [ ] Underlines appear on their own ~3s after typing stops, with no click
- [ ] Typing during those 3s cancels the pending check
- [ ] Text under 25 characters never triggers a call
- [ ] Typing a character then deleting it triggers no call (text unchanged)
- [ ] Two rapid edits produce one request, not two — the first is aborted
- [ ] The auto-trigger paints underlines but does NOT open the 007 panel
- [ ] Clicking Enhance still opens the panel with Good/Better immediately
- [ ] After a review, errors are underlined in place in the compose box
- [ ] Wrapped text produces one marker per visual line, correctly aligned
- [ ] Typing anywhere in the compose box clears all markers immediately
- [ ] Scrolling the compose box keeps markers aligned to their text
- [ ] Clicking a marker shows the fix; Accept replaces only that span
- [ ] After accepting one fix, remaining markers are still correctly aligned
- [ ] Text from the quoted reply below the compose area is never underlined
- [ ] **`document.querySelector('[contenteditable]').innerHTML` contains no
      `promptboost-` class, at any point, before or after accepting** — this
      is the load-bearing check that nothing can reach a sent email
- [ ] Closing and reopening compose leaves no orphaned overlay in the DOM
- [ ] Substack and chat surfaces show no underlines

## Open questions

If `getClientRects()` returns rects that do not align because Gmail applies a
CSS transform to a compose ancestor, report what you observed rather than
hard-coding an offset correction.
