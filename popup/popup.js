import {
  getProfiles,
  saveProfile,
  deleteProfile,
  createEmptyProfile,
  getCachedToken,
  domainMatchesUrl,
} from '../lib/storage.js';

// ── DOM References ──

const $profileList = document.getElementById('profile-list');
const $emptyState = document.getElementById('empty-state');
const $profileForm = document.getElementById('profile-form');
const $formTitle = document.getElementById('form-title');
const $currentTab = document.getElementById('current-tab');
const $currentTabUrl = document.getElementById('current-tab-url');

const $sectionActive = document.getElementById('section-active');
const $activeProfiles = document.getElementById('active-profiles');
const $noMatchNotice = document.getElementById('no-match-notice');
const $sectionAll = document.getElementById('section-all');
const $allProfiles = document.getElementById('all-profiles');
const $allProfilesCount = document.getElementById('all-profiles-count');
const $toggleAllProfiles = document.getElementById('toggle-all-profiles');
const $toggleArrow = document.getElementById('toggle-arrow');
const $allProfilesWrapper = document.getElementById('all-profiles-wrapper');
const $searchProfiles = document.getElementById('search-profiles');

const $inputName = document.getElementById('input-name');
const $inputUrl = document.getElementById('input-url');
const $toggleStatic = document.getElementById('toggle-static');
const $toggleOAuth = document.getElementById('toggle-oauth');
const $sectionStatic = document.getElementById('section-static');
const $sectionOAuth = document.getElementById('section-oauth');
const $headersList = document.getElementById('headers-list');
const $inputTokenUrl = document.getElementById('input-token-url');
const $inputClientId = document.getElementById('input-client-id');
const $inputClientSecret = document.getElementById('input-client-secret');

const $btnAdd = document.getElementById('btn-add');
const $btnAddHeader = document.getElementById('btn-add-header');
const $btnSave = document.getElementById('btn-save');
const $btnCancel = document.getElementById('btn-cancel');

// ── State ──

let currentTabUrl = '';
let editingProfileId = null;
let currentType = 'static';

// ── Init ──

document.addEventListener('DOMContentLoaded', async () => {
  await detectCurrentTab();
  await renderProfiles();
  bindEvents();
});

// ── Event Binding ──

function bindEvents() {
  $btnAdd.addEventListener('click', async () => {
    // Auto-fill domain if current tab doesn't have a matching profile
    let prefillDomain = '';
    if (currentTabUrl) {
      try {
        const hostname = new URL(currentTabUrl).hostname;
        const profiles = await getProfiles();
        const alreadyMatched = profiles.some(p => domainMatchesUrl(p.urlPattern, currentTabUrl));
        if (!alreadyMatched) {
          prefillDomain = hostname;
        }
      } catch { /* ignore */ }
    }
    openForm(null, prefillDomain);
  });
  $btnAddHeader.addEventListener('click', () => addHeaderRow('', ''));
  $btnSave.addEventListener('click', handleSave);
  $btnCancel.addEventListener('click', closeForm);

  $toggleStatic.addEventListener('click', () => setType('static'));
  $toggleOAuth.addEventListener('click', () => setType('oauth'));

  $toggleAllProfiles.addEventListener('click', () => {
    const collapsed = $allProfilesWrapper.classList.toggle('collapsed');
    $toggleArrow.textContent = collapsed ? '▸' : '▾';
    if (!collapsed) $searchProfiles.focus();
  });

  $searchProfiles.addEventListener('input', () => {
    const query = $searchProfiles.value.toLowerCase();
    $allProfiles.querySelectorAll('.profile-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? '' : 'none';
    });
  });
}

// ── Current Tab Detection ──

async function detectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentTabUrl = tab.url;
      const url = new URL(tab.url);
      $currentTabUrl.textContent = url.hostname;
      $currentTab.classList.remove('hidden');
    }
  } catch {
    // Not available
  }
}

// ── Profile Rendering ──

async function renderProfiles() {
  // Preserve scroll position
  const scrollTop = $profileList.scrollTop;

  const profiles = await getProfiles();

  // Clear all cards
  $activeProfiles.innerHTML = '';
  $allProfiles.innerHTML = '';

  if (profiles.length === 0) {
    $emptyState.classList.remove('hidden');
    $sectionActive.classList.add('hidden');
    $noMatchNotice.classList.add('hidden');
    $sectionAll.classList.add('hidden');
    return;
  }

  $emptyState.classList.add('hidden');

  // Split into matched (active on current tab) and all
  const matched = [];
  const rest = [];

  for (const profile of profiles) {
    const isMatched = currentTabUrl && profile.enabled && domainMatchesUrl(profile.urlPattern, currentTabUrl);
    if (isMatched) {
      matched.push(profile);
    }
    rest.push(profile); // "All" always contains everything
  }

  // Render active section
  if (matched.length > 0) {
    $sectionActive.classList.remove('hidden');
    $noMatchNotice.classList.add('hidden');
    for (const profile of matched) {
      const card = await createProfileCard(profile, true);
      $activeProfiles.appendChild(card);
    }
  } else if (currentTabUrl) {
    $sectionActive.classList.add('hidden');
    $noMatchNotice.classList.remove('hidden');
  } else {
    $sectionActive.classList.add('hidden');
    $noMatchNotice.classList.add('hidden');
  }

  // Render all profiles section
  $sectionAll.classList.remove('hidden');
  $allProfilesCount.textContent = profiles.length;
  for (const profile of rest) {
    const card = await createProfileCard(profile, false);
    $allProfiles.appendChild(card);
  }

  // Restore scroll position
  $profileList.scrollTop = scrollTop;
}

async function createProfileCard(profile, isActive) {
  const card = document.createElement('div');
  card.className = 'profile-card';
  if (!profile.enabled) card.classList.add('disabled');
  if (isActive) card.classList.add('matched');

  // Build status text for OAuth profiles
  let statusHtml = '';
  if (profile.type === 'oauth') {
    const token = await getCachedToken(profile.id).catch(() => null);
    const error = await getTokenError(profile.id);

    if (error) {
      statusHtml = `<div class="profile-status error">✗ ${escapeHtml(error.message).slice(0, 60)}</div>`;
    } else if (token) {
      const remaining = token.expiresAt ? Math.round((token.expiresAt - Date.now()) / 1000) : null;
      const timeStr = remaining !== null
        ? (remaining > 60 ? `${Math.round(remaining / 60)}m` : `${remaining}s`)
        : 'no expiry';
      statusHtml = `<div class="profile-status success">✓ Token active (${timeStr})</div>`;
    } else {
      statusHtml = `<div class="profile-status pending">○ No token cached</div>`;
    }
  } else {
    const headerCount = (profile.headers || []).filter(h => h.name && h.value).length;
    statusHtml = `<div class="profile-status pending">${headerCount} header${headerCount !== 1 ? 's' : ''}</div>`;
  }

  card.innerHTML = `
    <div class="profile-info">
      <div class="profile-name">
        ${escapeHtml(profile.name || 'Unnamed')}
        <span class="profile-badge ${profile.type === 'oauth' ? 'oauth' : ''}">${profile.type === 'oauth' ? 'OAuth' : 'Static'}</span>
      </div>
      <div class="profile-url">${escapeHtml(profile.urlPattern || '—')}</div>
      ${statusHtml}
    </div>
    <div class="profile-actions">
      ${profile.type === 'oauth' ? `<button class="btn-icon refresh" data-action="refresh" data-id="${profile.id}" title="Refresh token"><svg viewBox="0 0 24 24"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></button><button class="btn-icon clear" data-action="clear" data-id="${profile.id}" title="Clear token"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/></svg></button>` : ''}
      <label class="toggle-switch" title="${profile.enabled ? 'Disable' : 'Enable'}">
        <input type="checkbox" ${profile.enabled ? 'checked' : ''} data-action="toggle" data-id="${profile.id}">
        <span class="toggle-slider"></span>
      </label>
      <button class="btn-icon" data-action="delete" data-id="${profile.id}" title="Delete"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `;

  // Click card to edit
  card.querySelector('.profile-info').addEventListener('click', () => openForm(profile));

  // Toggle enable/disable
  card.querySelector('[data-action="toggle"]').addEventListener('change', async (e) => {
    e.stopPropagation();
    profile.enabled = e.target.checked;
    await saveProfile(profile);
    await renderProfiles();
  });

  // Delete
  const deleteBtn = card.querySelector('[data-action="delete"]');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (deleteBtn.classList.contains('confirm-delete')) {
      await deleteProfile(profile.id);
      await renderProfiles();
    } else {
      deleteBtn.classList.add('confirm-delete');
      deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg><span class="confirm-label">Confirm delete</span>`;
      setTimeout(() => {
        if (deleteBtn.classList.contains('confirm-delete')) {
          deleteBtn.classList.remove('confirm-delete');
          deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        }
      }, 3000);
    }
  });

  // Refresh token (OAuth only)
  const refreshBtn = card.querySelector('[data-action="refresh"]');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      refreshBtn.textContent = '…';
      refreshBtn.disabled = true;
      try {
        await chrome.runtime.sendMessage({ type: 'refreshToken', profileId: profile.id });
      } catch (err) {
        console.error('Refresh failed:', err);
      }
      await renderProfiles();
    });
  }

  // Clear token (OAuth only)
  const clearBtn = card.querySelector('[data-action="clear"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      clearBtn.textContent = '…';
      clearBtn.disabled = true;
      try {
        await chrome.runtime.sendMessage({ type: 'clearToken', profileId: profile.id });
      } catch (err) {
        console.error('Clear failed:', err);
      }
      await renderProfiles();
    });
  }

  return card;
}

// ── Form ──

function openForm(profile, prefillDomain = '') {
  $profileList.classList.add('hidden');
  $btnAdd.classList.add('hidden');
  $profileForm.classList.remove('hidden');

  if (profile) {
    editingProfileId = profile.id;
    $formTitle.textContent = 'Edit Profile';
    $inputName.value = profile.name || '';
    $inputUrl.value = profile.urlPattern || '';
    setType(profile.type || 'static');

    // Populate headers
    $headersList.innerHTML = '';
    if (profile.type === 'static' && profile.headers?.length) {
      profile.headers.forEach(h => addHeaderRow(h.name, h.value));
    } else {
      addHeaderRow('', '');
    }

    // Populate OAuth fields
    $inputTokenUrl.value = profile.tokenUrl || '';
    $inputClientId.value = profile.clientId || '';
    $inputClientSecret.value = profile.clientSecret || '';
  } else {
    editingProfileId = null;
    $formTitle.textContent = 'Add Profile';
    $inputName.value = '';
    $inputUrl.value = prefillDomain;
    setType('static');
    $headersList.innerHTML = '';
    addHeaderRow('', '');
    $inputTokenUrl.value = '';
    $inputClientId.value = '';
    $inputClientSecret.value = '';
  }

  $inputName.focus();
}

function closeForm() {
  $profileForm.classList.add('hidden');
  $profileList.classList.remove('hidden');
  $btnAdd.classList.remove('hidden');
  editingProfileId = null;
}

function setType(type) {
  currentType = type;
  $toggleStatic.classList.toggle('active', type === 'static');
  $toggleOAuth.classList.toggle('active', type === 'oauth');
  $sectionStatic.classList.toggle('hidden', type !== 'static');
  $sectionOAuth.classList.toggle('hidden', type !== 'oauth');
}

function addHeaderRow(name, value) {
  const row = document.createElement('div');
  row.className = 'header-row';
  row.innerHTML = `
    <input type="text" placeholder="Header name" value="${escapeAttr(name)}">
    <input type="text" placeholder="Value" value="${escapeAttr(value)}">
    <button class="btn-icon" title="Remove">✕</button>
  `;
  row.querySelector('.btn-icon').addEventListener('click', () => {
    row.remove();
    // Ensure at least one row
    if ($headersList.children.length === 0) addHeaderRow('', '');
  });
  $headersList.appendChild(row);
}

async function handleSave() {
  const name = $inputName.value.trim();
  const urlPattern = $inputUrl.value.trim();

  if (!name || !urlPattern) {
    alert('Name and URL pattern are required.');
    return;
  }

  let profile;
  if (editingProfileId) {
    const profiles = await getProfiles();
    profile = profiles.find(p => p.id === editingProfileId) || createEmptyProfile();
    profile.id = editingProfileId;
  } else {
    profile = createEmptyProfile();
  }

  profile.name = name;
  profile.urlPattern = urlPattern;
  profile.type = currentType;

  if (currentType === 'static') {
    profile.headers = [];
    $headersList.querySelectorAll('.header-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      const headerName = inputs[0].value.trim();
      const headerValue = inputs[1].value.trim();
      if (headerName || headerValue) {
        profile.headers.push({ name: headerName, value: headerValue });
      }
    });
    if (profile.headers.length === 0) {
      profile.headers = [{ name: '', value: '' }];
    }
  } else {
    profile.tokenUrl = $inputTokenUrl.value.trim();
    profile.clientId = $inputClientId.value.trim();
    profile.clientSecret = $inputClientSecret.value.trim();

    if (!profile.tokenUrl || !profile.clientId || !profile.clientSecret) {
      alert('Token URL, Client ID, and Client Secret are required for OAuth profiles.');
      return;
    }
  }

  await saveProfile(profile);
  closeForm();
  await renderProfiles();
}

// ── Helpers ──

async function getTokenError(profileId) {
  try {
    const key = `tokenError_${profileId}`;
    const result = await chrome.storage.session.get(key);
    return result[key] || null;
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
