// Profile schema:
// {
//   id: string (crypto.randomUUID),
//   name: string,
//   urlPattern: string (domain, e.g. "api.example.com"),
//   enabled: boolean,
//   type: "static" | "oauth",
//   // Static fields:
//   headers: [{ name: string, value: string }],
//   // OAuth fields:
//   environmentId: string | null (null = custom, credentials stored on the profile),
//   tokenUrl: string,
//   clientId: string,
//   clientSecret: string,
// }
//
// Environment schema:
// {
//   id: string (crypto.randomUUID),
//   name: string (e.g. "Acceptance"),
//   tokenUrl: string,
//   clientSecret: string (may be empty — profiles then supply their own),
// }

const PROFILES_KEY = 'profiles';
const ENVIRONMENTS_KEY = 'environments';
const TOKEN_CACHE_PREFIX = 'token_';

// ── Profile CRUD ──

export async function getProfiles() {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  return result[PROFILES_KEY] || [];
}

export async function getProfileById(id) {
  const profiles = await getProfiles();
  return profiles.find(p => p.id === id) || null;
}

export async function saveProfile(profile) {
  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.id === profile.id);
  if (index >= 0) {
    profiles[index] = profile;
  } else {
    profiles.push(profile);
  }
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  return profile;
}

export async function deleteProfile(id) {
  const profiles = await getProfiles();
  const filtered = profiles.filter(p => p.id !== id);
  await chrome.storage.local.set({ [PROFILES_KEY]: filtered });
  // Also clear any cached token
  await clearCachedToken(id);
}

export function createEmptyProfile() {
  return {
    id: crypto.randomUUID(),
    name: '',
    urlPattern: '',
    enabled: true,
    type: 'static',
    headers: [{ name: '', value: '' }],
    environmentId: null,
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
  };
}

// ── Environment CRUD ──
// A named token endpoint (plus an optional shared client secret) that OAuth
// profiles link to instead of storing their own copy.

export async function getEnvironments() {
  const result = await chrome.storage.local.get(ENVIRONMENTS_KEY);
  return result[ENVIRONMENTS_KEY] || [];
}

export async function saveEnvironment(environment) {
  const environments = await getEnvironments();
  const index = environments.findIndex(e => e.id === environment.id);
  if (index >= 0) {
    environments[index] = environment;
  } else {
    environments.push(environment);
  }
  await chrome.storage.local.set({ [ENVIRONMENTS_KEY]: environments });
  return environment;
}

export async function deleteEnvironment(id) {
  const environments = await getEnvironments();
  const filtered = environments.filter(e => e.id !== id);
  await chrome.storage.local.set({ [ENVIRONMENTS_KEY]: filtered });
}

export function createEmptyEnvironment() {
  return {
    id: crypto.randomUUID(),
    name: '',
    tokenUrl: '',
    clientSecret: '',
  };
}

export function findEnvironment(environments, id) {
  return environments.find(e => e.id === id) || null;
}

// ── OAuth Credential Resolution ──
// The single place that decides which token URL and secret an OAuth profile uses.
// A linked profile takes the URL from its environment; the secret comes from the
// environment when it has one, otherwise from the profile (production typically
// has no shared secret).

export function resolveOAuthConfig(profile, environments) {
  const base = {
    tokenUrl: profile.tokenUrl || '',
    clientId: profile.clientId || '',
    clientSecret: profile.clientSecret || '',
    environmentName: null,
    error: null,
  };

  if (!profile.environmentId) return base;

  const environment = findEnvironment(environments, profile.environmentId);
  if (!environment) {
    return { ...base, error: 'Linked environment no longer exists' };
  }

  return {
    ...base,
    tokenUrl: environment.tokenUrl || '',
    clientSecret: environment.clientSecret || base.clientSecret,
    environmentName: environment.name,
  };
}

// ── OAuth Token Cache ──
// Stored in chrome.storage.session (cleared on browser close)

export async function getCachedToken(profileId) {
  const key = TOKEN_CACHE_PREFIX + profileId;
  const result = await chrome.storage.session.get(key);
  const cached = result[key];
  if (!cached) return null;

  // Check expiry
  if (cached.expiresAt && Date.now() >= cached.expiresAt) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return cached;
}

export async function setCachedToken(profileId, tokenData) {
  const key = TOKEN_CACHE_PREFIX + profileId;
  const entry = {
    accessToken: tokenData.access_token,
    tokenType: tokenData.token_type || 'Bearer',
    expiresAt: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : null,
    fetchedAt: Date.now(),
  };
  await chrome.storage.session.set({ [key]: entry });
  return entry;
}

export async function clearCachedToken(profileId) {
  const key = TOKEN_CACHE_PREFIX + profileId;
  try {
    await chrome.storage.session.remove(key);
  } catch {
    // session storage may not be available in all contexts
  }
}

// ── Rule ID Generation ──
// Each profile gets a block of 100 rule IDs: profileIndex * 100 + headerIndex
// This supports up to 100 headers per profile and many profiles.

export function getRuleIdsForProfile(profileIndex, headerCount) {
  const base = (profileIndex + 1) * 100; // start at 100 to avoid 0
  const ids = [];
  for (let i = 0; i < headerCount; i++) {
    ids.push(base + i);
  }
  return ids;
}

// For OAuth profiles, rule ID is just the base ID (one Authorization header)
export function getOAuthRuleId(profileIndex) {
  return (profileIndex + 1) * 100;
}

// ── URL Pattern Helpers ──

export function domainToUrlFilter(domain) {
  // Strip protocol if user accidentally includes it
  domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `||${domain}/`;
}

export function domainMatchesUrl(domain, url) {
  try {
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    // Exact match or subdomain match
    return hostname === domain || hostname.endsWith('.' + domain);
  } catch {
    return false;
  }
}
