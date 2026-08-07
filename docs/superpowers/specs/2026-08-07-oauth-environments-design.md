# OAuth Environments — Design

**Date:** 2026-08-07
**Repo:** api-header-appender
**Status:** approved

## Problem

Nearly every OAuth profile points at one of the same three token endpoints (testing,
acceptance, production), and testing and acceptance share a client secret. Today each
profile stores its own copy of the token URL and secret, so creating a profile means
re-typing both, and rotating the shared secret means editing every profile by hand.

## Solution

A named **environment** — token URL plus an optional default client secret — that OAuth
profiles link to. Environments are created and edited by the user in the popup and stored
locally; none are shipped in the source, because this repository is public and its
endpoints and shared secret are internal.

A profile stays *linked* to its environment rather than copying values out of it. Credentials
resolve at token-fetch time, so rotating the acceptance secret is one edit.

## Data model

New `chrome.storage.local` key `environments`, alongside `profiles`:

```js
{
  id: string,           // crypto.randomUUID()
  name: string,         // "Acceptance"
  tokenUrl: string,
  clientSecret: string, // may be '' — production typically has no shared secret
}
```

Profiles gain one field:

```js
environmentId: string | null   // null = "Custom", today's behaviour
```

`tokenUrl` and `clientSecret` remain on the profile and are used when it is unlinked.
Existing profiles need no migration: a missing `environmentId` reads as `null`.

## Credential resolution

`lib/storage.js` exposes a single resolver:

```js
resolveOAuthConfig(profile, environments)
  → { tokenUrl, clientId, clientSecret, environmentName, error }
```

- `tokenUrl` — the environment's when linked, otherwise the profile's own.
- `clientSecret` — the environment's if it has one, otherwise the profile's. This is what
  lets production exist as an environment with no shared secret while each profile still
  supplies its own.
- `clientId` — always the profile's.
- Linked to an environment that no longer exists → `error` describing the missing link.

`fetchOAuthToken()` in `background.js` calls this instead of reading `profile.tokenUrl`,
`profile.clientId`, and `profile.clientSecret` directly. That function is the only place
credentials are read, so it is the only call site. Rule syncing, alarms, and the DNR layer
are untouched — they only ever see the resulting access token.

## UI

### Environments screen

A gear button in the popup header, next to **+ Add**, opens a full-screen environments
view using the same show/hide pattern as the profile form. It lists each environment with
its name, token URL, and whether a secret is saved, plus edit and delete actions, and a
**+ New** button. The edit form is three fields: name, token URL, client secret.

### Profile form

The OAuth section gains an **Environment** dropdown above the credential fields, listing
`Custom (enter manually)` followed by the saved environments.

- **Custom** — Token URL, Client ID, and Client Secret, exactly as before.
- **An environment selected** — the Token URL input is replaced by a read-only line showing
  the resolved URL. Client ID stays editable. Client Secret is hidden when the environment
  supplies one (shown as `● from Acceptance`) and displayed as a required field when it
  does not.

Creating an acceptance profile becomes: name, domain, pick *Acceptance*, type client ID, save.

## Edge cases

- **Deleting an environment in use** — deletion is a two-step inline confirm, matching how
  profile cards already handle it rather than introducing a dialog. The first click names the
  profiles that would break; the second deletes. Those profiles then display
  `✗ Linked environment no longer exists` on their card, and token fetches fail with that
  message rather than silently doing nothing. The message omits the deleted environment's
  name so no snapshot of it has to be kept on the profile.
- **Editing an environment** — cached tokens for linked profiles are cleared and their
  refresh alarms cancelled, so the next page load fetches against the new URL or secret
  instead of riding a stale token. `background.js` detects this by diffing the old and new
  `environments` value in its existing `chrome.storage.onChanged` listener.
- **Save validation** — a profile linked to an environment requires only a client ID; an
  unlinked profile keeps the existing three-field check.
- **Scope** — environments apply to OAuth profiles only. Static-header profiles are unchanged.
- **Popup height** — the environment row makes the OAuth form taller than the popup. The
  popup grows to Chrome's 600px maximum, the profile form scrolls, and the action row is
  pinned to the bottom so Save stays reachable.

## Trade-off accepted

Linking puts the shared secret in one place, which is the point, but it also means a typo in
an environment breaks every profile using it at once. Clearing cached tokens on edit is what
makes that recoverable with a single correction rather than a browser restart.

## Verification

The repository has no test framework, so verification is manual in Chrome:

1. Create the three environments; confirm they persist across a popup close and reopen.
2. Point a profile at acceptance with only a client ID; confirm a token is fetched and the
   `Authorization` header is applied.
3. Edit the acceptance token URL; confirm the cached token is dropped and re-fetched on the
   next page load.
4. Delete an environment that is in use; confirm the confirmation names the profiles and the
   linked profile then reports the broken link.
5. Confirm a pre-existing unlinked profile still fetches tokens unchanged.
