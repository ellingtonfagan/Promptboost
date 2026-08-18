# 010 — CI secret scan matched the example config

**Status:** `done` — resolved differently than proposed. No change to `server/`.

## Problem

The secret scan added in [009](009-public-repo-scaffold.md) used the pattern
`sk-(ant|proj)-`, which matched `server/config.example.json` — that file
legitimately contains `"apiKey": "sk-ant-..."` as a placeholder. CI would
have failed red on the first push of a clean repository.

Codex correctly flagged this rather than editing `server/`, which ticket 009
forbade.

## Why the proposed fix was rejected

The original proposal was to change the placeholder in
`server/config.example.json`. That treats the symptom. The example file
*should* show the real prefix — that is what makes it a useful example, and a
new user copying it needs to recognise the shape of the value they are
pasting.

An exclude-list would also have worked and was also rejected: it needs
maintaining, and it creates a path where a real key committed to an excluded
file goes undetected.

## Actual fix

Require enough key characters that a placeholder cannot match:

```
sk-(ant|proj)-[A-Za-z0-9_-]{20,}
```

`sk-ant-...` has three dots after the prefix and does not match. A genuine key
has 90+ characters after it and does match, in any file, including the example
config itself.

Verified both directions before commit:

- Clean tree → zero matches → CI green
- `sk-ant-api03-AAAA…` (36 chars) planted in a repo file → detected → CI red

## Acceptance criteria

- [x] Clean tree produces no secret-scan match
- [x] A planted realistic key is detected
- [x] `server/config.example.json` unchanged
- [x] No exclude-list required
