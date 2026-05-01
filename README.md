# API Header Appender

Chrome extension (Manifest V3) that automatically injects HTTP headers into API requests based on URL patterns. Like ModHeader, but with automatic per-domain switching and built-in OAuth client credentials support.

<img width="512" height="277" alt="image" src="https://github.com/user-attachments/assets/f483ebac-e960-447d-844d-34473838cdb8" />
<img width="510" height="274" alt="image" src="https://github.com/user-attachments/assets/76750a03-3def-46e2-923f-15548f1d8f7b" />

## Features

- **Static Headers** — Set custom headers (e.g. `X-Api-Key`, `ApiKey`) that are automatically applied to requests matching a domain pattern
- **OAuth Tokens** — Automatically fetch bearer tokens via client credentials grant, cache them based on `expires_in`, and inject `Authorization` headers
- **Per-Domain Matching** — Configure different headers for different APIs; the right headers are applied based on the request's domain
- **Auto-Refresh** — OAuth tokens are automatically refreshed before they expire
- **Swagger UI Compatible** — Headers are injected into XHR/fetch requests made by Swagger UI's "Try it out" feature

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the `api-header-appender` folder
5. The extension icon appears in the toolbar

## Usage

### Static Headers (API Keys)

1. Click the extension icon → **+ Add**
2. Enter a name and the domain to match (e.g. `api.example.com`)
3. Select **Static Headers**
4. Add header name/value pairs (e.g. `X-Api-Key` / `your-key-here`)
5. Save — headers are immediately active for all requests to that domain

### OAuth Tokens

1. Click the extension icon → **+ Add**
2. Enter a name and the domain to match
3. Select **OAuth Token**
4. Enter the **Token URL** (e.g. `https://auth.example.com/connect/token`)
5. Enter **Client ID** and **Client Secret**
6. Save — the extension fetches a token immediately when the domain loads and sets the `Authorization` header
7. Tokens are refreshed after expiry when refreshing the page

### Profile Management

- **Enable/Disable** — Toggle profiles on/off without deleting them
- **Edit** — Click a profile card to modify its settings
- **Delete** — Click the ✕ button on a profile card
- **Manual Refresh** — Click ↻ on OAuth profiles to force a token refresh

## How It Works

- Uses Chrome's `declarativeNetRequest` API to modify request headers at the network level
- Static header rules persist across browser sessions (dynamic DNR rules)
- OAuth token rules are stored as session rules (cleared on browser close for security)
- OAuth tokens are cached in `chrome.storage.session` with expiry tracking
- `chrome.alarms` handles proactive token refresh before expiry
- All matching profiles are active simultaneously — no manual switching needed

## Project Structure

```
api-header-appender/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker: DNR rules, OAuth, alarms
├── lib/
│   └── storage.js         # Profile CRUD, token cache helpers
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Popup styles
└── icons/                 # Extension icons (16, 48, 128px)
```

## Permissions

| Permission | Purpose |
|---|---|
| `declarativeNetRequest` | Modify request headers |
| `storage` | Persist profile configurations |
| `alarms` | Schedule OAuth token refresh |
| `tabs` | Detect current tab URL for badge/matching |
| `<all_urls>` | Apply headers to any domain |

## Security & Storage

All data is stored locally on your machine within Chrome's extension storage. Nothing is sent to external servers (other than the OAuth token endpoints you configure).

| Data | Storage | Persistence | Notes |
|---|---|---|---|
| Profile configs (name, URL pattern, type) | `chrome.storage.local` | Persists across browser restarts | Only accessible to this extension |
| Client ID & Client Secret | `chrome.storage.local` | Persists across browser restarts | Only accessible to this extension |
| Access tokens | `chrome.storage.session` | **Cleared on browser close** | Never written to disk long-term |
| Static header values (API keys) | `chrome.storage.local` | Persists across browser restarts | Applied as dynamic DNR rules |
| OAuth authorization rules | Session DNR rules | **Cleared on browser close** | Auto-removed when browser shuts down |

**Things to be aware of:**

- Credentials are **not encrypted at rest** — Chrome's extension storage API does not offer encryption. This is a known limitation shared by all Chrome extensions
- Anyone with physical access to your machine could inspect stored data via `chrome://extensions` → service worker DevTools → Application → Storage
- Data is **never synced** to your Google account — we use `chrome.storage.local`, not `chrome.storage.sync`
- This is the same trust model used by ModHeader, Requestly, and similar browser extensions

**Bottom line:** Safe for a personal development tool.

## Updating

1. Pull the latest changes:
   ```bash
   cd api-header-appender
   git pull
   ```
2. Open `chrome://extensions/`
3. Click the **refresh button** (↻) on the API Header Appender card
4. Done — your profiles and static headers are preserved. OAuth tokens will be re-fetched automatically when you next visit a matching domain
