# Trace IDs (correlation & attempt) — Design

**Date:** 2026-08-07
**Repo:** api-header-appender
**Status:** approved

## Problem

Debugging an API call means finding it again in the logs. That needs a known identifier
travelling with the request. Two are wanted: a **correlation ID** grouping related calls and
an **attempt ID** identifying a single call. The header names differ per organisation, so
they cannot be hardcoded.

A standalone UUID generator is wanted alongside this — a value with a cycle button and a
copy button, independent of any profile.

## Platform constraint that shapes the design

This was researched against Chrome documentation and Chromium source before designing,
because it rules out the obvious approach.

1. `declarativeNetRequest` `modifyHeaders` takes a **static string** value, fixed when the
   rule is registered. There is no per-request templating. The standards issue requesting it
   (w3c/webextensions#626) has been open since June 2024 with no vendor response.
2. Regenerating the value on navigation does not work. `tabs.onUpdated` reports `loading` at
   navigation *commit* — after the main frame's request headers have been sent — and Chrome
   never re-evaluates in-flight requests against updated rules. A Chromium bug
   (issues.chromium.org/349653211) shows this failing in the wild on cold start.
3. A genuinely per-request value therefore requires patching `fetch` and `XMLHttpRequest`
   from a MAIN-world content script (Chrome 111+). That covers page JavaScript, including
   Swagger UI's "Try it out", but not navigations, web workers, other extensions, or page
   code holding a `fetch` reference captured before the patch ran. It needs the `scripting`
   permission and a content script, neither of which this extension has.
4. Custom header names must use `operation: 'set'`. DNR's `append` only accepts an allowlist
   of standard headers, which excludes `X-…` and vendor-prefixed names.

**Decision:** IDs are session-stable and cycled on demand, staying entirely within
`declarativeNetRequest`. No new permissions, no coverage gaps, no races. A correlation ID
*should* be stable — that is what makes it correlate — so this costs nothing there. It does
mean the attempt ID is not per-call; see "Accepted limitation".

## Data model

Global settings, `chrome.storage.local` key `tracing`:

```js
{
  correlationHeader: 'X-Correlation-Id',  // user sets e.g. Coolblue-CorrelationId
  attemptHeader: 'X-Attempt-Id',
}
```

Live values, `chrome.storage.session` key `traceIds`:

```js
{ correlationId: string, attemptId: string }
```

Session storage clears on browser close, mirroring OAuth token handling, so each browser
session starts a fresh trace.

Profiles gain one field: `tracing: boolean`, default `false`. Missing reads as `false`, so
existing profiles need no migration.

There is deliberately **no "pinned" flag**. Values change only when cycled, so writing a
chosen UUID into `correlationId` *is* pinning it.

## Rule generation

In `syncAllRules()`, each enabled profile with `tracing: true` contributes **one additional
session rule** setting both headers:

- Rule id: `getTracingRuleId(profileIndex)` = `(profileIndex + 1) * 100 + 50`. The session
  namespace otherwise holds only the OAuth rule at `(profileIndex + 1) * 100`; static header
  rules live in the dynamic namespace, so nothing collides.
- `operation: 'set'` for both headers, per the constraint above.
- A header whose configured name is empty is omitted rather than sent empty. If both are
  empty, no rule is added.

This is what makes tracing work for both profile types: a static profile keeps its API-key
dynamic rules and gains a tracing session rule, an OAuth profile keeps its `Authorization`
session rule and gains a tracing session rule. Rules match independently and set different
headers, so Chrome applies all of them.

`syncAllRules()` also swaps the order in which it applies the two rule sets, applying session
rules before dynamic ones. Chrome runs both APIs through a single FIFO queue per extension,
and `updateDynamicRules` performs two atomic file writes on the file sequence before
returning, whereas `updateSessionRules` installs its matcher synchronously on the UI thread.
Updating dynamic rules first therefore held the volatile rules — tokens and trace IDs —
behind disk I/O. Dynamic rules persist across restarts, so they are already in place when it
matters.

IDs are generated when missing — on startup, and on the first sync of a browser session —
by `ensureTraceIds()`. The `chrome.storage.onChanged` listener is extended to the `session`
area so cycling an ID re-syncs the rules immediately, and to the local `tracing` key so
renaming a header does the same.

## UI

### Trace IDs screen

A second icon in the popup header, beside the environments gear, opens it. Three sections:

- **Scratch UUID** — a monospace value with cycle and copy buttons, unconnected to any
  profile. Plus **Use as correlation ID**, which writes it into the active correlation ID.
- **Active IDs** — the correlation ID and attempt ID, each with its own value, cycle, and
  copy. Cycling the correlation ID also cycles the attempt ID, since a new trace begins a new
  attempt. The attempt ID can be cycled on its own.
- **Header names** — two fields defaulting to `X-Correlation-Id` and `X-Attempt-Id`, with a
  save button. They live here rather than in Environments because they belong to tracing, and
  this avoids a third settings screen.

### Profile form

A **Send tracing headers** switch directly under the Type toggle — above the static/OAuth
split, because it applies to both. Off for new profiles. Traced profiles show a `trace` badge
on their card.

## Edge cases

- **Header name validation** — names are trimmed and must be a valid HTTP token (no
  whitespace, no colon). An invalid name is rejected on save; an emptied field falls back to
  the default.
- **Enabling tracing with no IDs yet** — they are generated on the spot.
- **Copying** — `navigator.clipboard.writeText`, with the `clipboardWrite` permission declared
  rather than relying on the secure-context-plus-gesture path alone. The copy button briefly
  confirms; if the write is rejected anyway, the value is left selected so it is still one
  keystroke away rather than the click doing nothing.

## Accepted limitation

The attempt ID is session-stable, not per-call. Making it genuinely per-call requires the
MAIN-world content script described above, which was considered and declined for now. It can
be added later as an opt-in on top of this design without changing any of it: the DNR rule
stays as the baseline, and the content script would override the attempt header for requests
it can see.

## Verification

No test framework in the repo, so: an out-of-tree jsdom harness driving the popup (cycling,
pinning a scratch UUID as the correlation ID, the per-profile switch, header-name validation,
and the shape of the generated rules), headless renders of the new screen, and a manual check
in Chrome — devtools on a Swagger "Try it out" call showing both headers on the wire.
