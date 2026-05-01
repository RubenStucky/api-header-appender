import {
  getProfiles,
  getCachedToken,
  setCachedToken,
  clearCachedToken,
  getRuleIdsForProfile,
  getOAuthRuleId,
  domainToUrlFilter,
} from './lib/storage.js';

// Resource types to intercept (covers Swagger UI XHR, fetch, and page loads)
const RESOURCE_TYPES = [
  'xmlhttprequest', 'main_frame', 'sub_frame',
  'script', 'image', 'font', 'stylesheet', 'media', 'other',
];

const ALARM_PREFIX = 'refresh_token_';

// ── Lifecycle Events ──

chrome.runtime.onInstalled.addListener(() => {
  console.log('[API Header Appender] Installed');
  syncAllRules();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[API Header Appender] Startup');
  syncAllRules();
});

// Re-sync rules whenever profiles are modified (e.g. from popup)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.profiles) {
    console.log('[API Header Appender] Profiles changed, syncing rules');
    syncAllRules();
  }
});

// Handle token refresh alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    const profileId = alarm.name.slice(ALARM_PREFIX.length);
    console.log(`[API Header Appender] Token refresh alarm for profile ${profileId}`);
    const profiles = await getProfiles();
    const profileIndex = profiles.findIndex(p => p.id === profileId);
    if (profileIndex < 0) return;
    const profile = profiles[profileIndex];
    if (!profile.enabled || profile.type !== 'oauth') return;

    await refreshOAuthToken(profile, profileIndex);
  }
});

// Update badge when active tab changes
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateIcon(tab);
  } catch { /* tab may have closed */ }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateIcon(tab);
    // Auto-fetch missing OAuth tokens when navigating to a matching domain
    if (tab.url) {
      await autoFetchTokensForUrl(tab.url);
      // Update icon again after token fetch (may have changed from pending to active)
      await updateIcon(tab);
    }
  }
});

// Listen for manual token refresh requests from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'refreshToken') {
    handleManualRefresh(message.profileId).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (message.type === 'clearToken') {
    handleClearToken(message.profileId).then(sendResponse);
    return true;
  }
  if (message.type === 'syncRules') {
    syncAllRules().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── Core Rule Sync ──

async function syncAllRules() {
  const profiles = await getProfiles();

  // Collect all rule IDs we want to set, and remove everything else
  const dynamicRules = [];
  const sessionRules = [];
  const dynamicRemoveIds = [];
  const sessionRemoveIds = [];

  // First, clear all existing rules from previous syncs
  try {
    const existingDynamic = await chrome.declarativeNetRequest.getDynamicRules();
    dynamicRemoveIds.push(...existingDynamic.map(r => r.id));
  } catch { /* ignore */ }

  try {
    const existingSession = await chrome.declarativeNetRequest.getSessionRules();
    sessionRemoveIds.push(...existingSession.map(r => r.id));
  } catch { /* ignore */ }

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    if (!profile.enabled) continue;

    if (profile.type === 'static') {
      const validHeaders = (profile.headers || []).filter(h => h.name && h.value);
      const ruleIds = getRuleIdsForProfile(i, validHeaders.length);

      for (let j = 0; j < validHeaders.length; j++) {
        dynamicRules.push({
          id: ruleIds[j],
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{
              header: validHeaders[j].name,
              operation: 'set',
              value: validHeaders[j].value,
            }],
          },
          condition: {
            urlFilter: domainToUrlFilter(profile.urlPattern),
            resourceTypes: RESOURCE_TYPES,
          },
        });
      }
    } else if (profile.type === 'oauth') {
      // Only use cached token — don't auto-fetch on reload/sync
      const token = await getCachedToken(profile.id);

      if (token) {
        const ruleId = getOAuthRuleId(i);
        const authValue = `${capitalize(token.tokenType)} ${token.accessToken}`;

        sessionRules.push({
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{
              header: 'Authorization',
              operation: 'set',
              value: authValue,
            }],
          },
          condition: {
            urlFilter: domainToUrlFilter(profile.urlPattern),
            resourceTypes: RESOURCE_TYPES,
          },
        });
      }
    }
  }

  // Apply rules atomically
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: dynamicRemoveIds,
      addRules: dynamicRules,
    });
    console.log(`[API Header Appender] Applied ${dynamicRules.length} dynamic rules`);
  } catch (err) {
    console.error('[API Header Appender] Failed to update dynamic rules:', err);
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: sessionRemoveIds,
      addRules: sessionRules,
    });
    console.log(`[API Header Appender] Applied ${sessionRules.length} session rules`);
  } catch (err) {
    console.error('[API Header Appender] Failed to update session rules:', err);
  }

  // Update badge for current tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await updateIcon(tab);
  } catch { /* ignore */ }
}

// ── OAuth Token Fetching ──

async function fetchOAuthToken(profile) {
  if (!profile.tokenUrl || !profile.clientId || !profile.clientSecret) {
    console.warn(`[API Header Appender] OAuth profile "${profile.name}" missing credentials`);
    return null;
  }

  try {
    console.log(`[API Header Appender] Fetching token from ${profile.tokenUrl}`);
    const response = await fetch(profile.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: profile.clientId,
        client_secret: profile.clientSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[API Header Appender] Token request failed (${response.status}): ${text}`);
      await setTokenError(profile.id, `HTTP ${response.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    if (!data.access_token) {
      console.error('[API Header Appender] Token response missing access_token:', data);
      await setTokenError(profile.id, 'Response missing access_token');
      return null;
    }

    const cached = await setCachedToken(profile.id, data);
    await clearTokenError(profile.id);
    console.log(`[API Header Appender] Token cached for profile "${profile.name}", expires in ${data.expires_in}s`);
    return cached;
  } catch (err) {
    console.error(`[API Header Appender] Token fetch error for "${profile.name}":`, err);
    await setTokenError(profile.id, err.message);
    return null;
  }
}

async function refreshOAuthToken(profile, profileIndex) {
  const token = await fetchOAuthToken(profile);
  if (!token) return;

  await scheduleTokenRefresh(profile, token);

  // Update the session rule with the new token
  const ruleId = getOAuthRuleId(profileIndex);
  const authValue = `${capitalize(token.tokenType)} ${token.accessToken}`;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Authorization',
            operation: 'set',
            value: authValue,
          }],
        },
        condition: {
          urlFilter: domainToUrlFilter(profile.urlPattern),
          resourceTypes: RESOURCE_TYPES,
        },
      }],
    });
  } catch (err) {
    console.error('[API Header Appender] Failed to update session rule after refresh:', err);
  }
}

async function handleManualRefresh(profileId) {
  const profiles = await getProfiles();
  const profileIndex = profiles.findIndex(p => p.id === profileId);
  if (profileIndex < 0) return { error: 'Profile not found' };

  const profile = profiles[profileIndex];
  if (profile.type !== 'oauth') return { error: 'Not an OAuth profile' };

  const token = await fetchOAuthToken(profile);
  if (!token) return { error: 'Token fetch failed' };

  await scheduleTokenRefresh(profile, token);

  // Re-sync to apply the new token
  await syncAllRules();
  return { ok: true, tokenType: token.tokenType, expiresAt: token.expiresAt };
}

async function handleClearToken(profileId) {
  await clearCachedToken(profileId);
  await clearTokenError(profileId);
  // Cancel any scheduled refresh
  await chrome.alarms.clear(ALARM_PREFIX + profileId);
  // Re-sync to remove the session rule
  await syncAllRules();
  return { ok: true };
}

// ── Token Refresh Scheduling ──

async function scheduleTokenRefresh(profile, token) {
  if (!token.expiresAt) return;

  const alarmName = ALARM_PREFIX + profile.id;
  const msUntilExpiry = token.expiresAt - Date.now();
  // Refresh 60 seconds before expiry, minimum 1 minute from now
  const delayMs = Math.max(msUntilExpiry - 60_000, 60_000);

  await chrome.alarms.create(alarmName, {
    delayInMinutes: delayMs / 60_000,
  });

  console.log(`[API Header Appender] Scheduled refresh for "${profile.name}" in ${Math.round(delayMs / 1000)}s`);
}

// ── Token Error Storage ──

async function setTokenError(profileId, message) {
  const key = `tokenError_${profileId}`;
  try {
    await chrome.storage.session.set({ [key]: { message, timestamp: Date.now() } });
  } catch { /* ignore */ }
}

async function clearTokenError(profileId) {
  const key = `tokenError_${profileId}`;
  try {
    await chrome.storage.session.remove(key);
  } catch { /* ignore */ }
}

// ── Auto-Fetch on Navigation ──

async function autoFetchTokensForUrl(url) {
  const profiles = await getProfiles();
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    if (!profile.enabled || profile.type !== 'oauth') continue;

    try {
      const domain = profile.urlPattern.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
      const hostname = new URL(url).hostname.toLowerCase();
      const matches = hostname === domain || hostname.endsWith('.' + domain);
      if (!matches) continue;
    } catch {
      continue;
    }

    // Only fetch if no valid cached token exists
    const cached = await getCachedToken(profile.id);
    if (cached) continue;

    console.log(`[API Header Appender] Auto-fetching token for "${profile.name}" (navigated to matching domain)`);
    const token = await fetchOAuthToken(profile);
    if (token) {
      await scheduleTokenRefresh(profile, token);
      // Apply the new token rule immediately
      const ruleId = getOAuthRuleId(i);
      const authValue = `${capitalize(token.tokenType)} ${token.accessToken}`;
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [ruleId],
          addRules: [{
            id: ruleId,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [{
                header: 'Authorization',
                operation: 'set',
                value: authValue,
              }],
            },
            condition: {
              urlFilter: domainToUrlFilter(profile.urlPattern),
              resourceTypes: RESOURCE_TYPES,
            },
          }],
        });
      } catch (err) {
        console.error('[API Header Appender] Failed to apply auto-fetched token rule:', err);
      }
    }
  }
}

// ── Icon State ──

async function updateIcon(tab) {
  if (!tab?.url) {
    await setIconState('inactive', tab?.id);
    return;
  }

  const profiles = await getProfiles();
  let hasActiveMatch = false;
  let hasPendingMatch = false;

  for (const p of profiles) {
    if (!p.enabled) continue;
    try {
      const domain = p.urlPattern.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
      const hostname = new URL(tab.url).hostname.toLowerCase();
      const matches = hostname === domain || hostname.endsWith('.' + domain);
      if (!matches) continue;
    } catch {
      continue;
    }

    if (p.type === 'static') {
      hasActiveMatch = true;
    } else if (p.type === 'oauth') {
      const token = await getCachedToken(p.id);
      if (token) {
        hasActiveMatch = true;
      } else {
        hasPendingMatch = true;
      }
    }
  }

  if (hasActiveMatch) {
    await setIconState('active', tab.id);
  } else if (hasPendingMatch) {
    await setIconState('pending', tab.id);
  } else {
    await setIconState('inactive', tab.id);
  }
}

async function setIconState(state, tabId) {
  const details = {
    path: {
      16: `icons/icon-${state}-16.png`,
      48: `icons/icon-${state}-48.png`,
      128: `icons/icon-${state}-128.png`,
    },
  };
  if (tabId) details.tabId = tabId;

  try {
    await chrome.action.setIcon(details);
  } catch { /* ignore */ }
}

// ── Helpers ──

function capitalize(str) {
  if (!str) return 'Bearer';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
