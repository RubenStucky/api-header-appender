import {
  getProfiles,
  saveProfile,
  deleteProfile,
  createEmptyProfile,
  getEnvironments,
  saveEnvironment,
  deleteEnvironment,
  createEmptyEnvironment,
  findEnvironment,
  resolveOAuthConfig,
  getTracingSettings,
  saveTracingSettings,
  isValidHeaderName,
  ensureTraceIds,
  setTraceIds,
  newUuid,
  DEFAULT_TRACING_SETTINGS,
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

const $selectEnvironment = document.getElementById('select-environment');
const $groupTokenUrl = document.getElementById('group-token-url');
const $groupEnvTokenUrl = document.getElementById('group-env-token-url');
const $envTokenUrlDisplay = document.getElementById('env-token-url-display');
const $groupClientSecret = document.getElementById('group-client-secret');
const $groupEnvClientSecret = document.getElementById('group-env-client-secret');
const $envSecretSource = document.getElementById('env-secret-source');
const $clientSecretHint = document.getElementById('client-secret-hint');

const $headerActions = document.querySelector('.header-actions');
const $btnAdd = document.getElementById('btn-add');
const $btnAddHeader = document.getElementById('btn-add-header');
const $btnSave = document.getElementById('btn-save');
const $btnCancel = document.getElementById('btn-cancel');

const $btnEnvironments = document.getElementById('btn-environments');
const $environmentsScreen = document.getElementById('environments-screen');
const $btnEnvironmentsBack = document.getElementById('btn-environments-back');
const $btnAddEnvironment = document.getElementById('btn-add-environment');
const $environmentList = document.getElementById('environment-list');
const $environmentsEmpty = document.getElementById('environments-empty');
const $environmentForm = document.getElementById('environment-form');
const $environmentFormTitle = document.getElementById('environment-form-title');
const $inputEnvName = document.getElementById('input-env-name');
const $inputEnvTokenUrl = document.getElementById('input-env-token-url');
const $inputEnvClientSecret = document.getElementById('input-env-client-secret');
const $btnSaveEnvironment = document.getElementById('btn-save-environment');
const $btnCancelEnvironment = document.getElementById('btn-cancel-environment');

const $inputTracing = document.getElementById('input-tracing');
const $btnTrace = document.getElementById('btn-trace');
const $traceScreen = document.getElementById('trace-screen');
const $btnTraceBack = document.getElementById('btn-trace-back');
const $scratchUuid = document.getElementById('scratch-uuid');
const $btnCycleScratch = document.getElementById('btn-cycle-scratch');
const $btnCopyScratch = document.getElementById('btn-copy-scratch');
const $btnUseScratch = document.getElementById('btn-use-scratch');
const $correlationId = document.getElementById('correlation-id');
const $btnCycleCorrelation = document.getElementById('btn-cycle-correlation');
const $btnCopyCorrelation = document.getElementById('btn-copy-correlation');
const $attemptId = document.getElementById('attempt-id');
const $btnCycleAttempt = document.getElementById('btn-cycle-attempt');
const $btnCopyAttempt = document.getElementById('btn-copy-attempt');
const $inputCorrelationHeader = document.getElementById('input-correlation-header');
const $inputAttemptHeader = document.getElementById('input-attempt-header');
const $btnSaveTracing = document.getElementById('btn-save-tracing');

// ── State ──

let currentTabUrl = '';
let editingProfileId = null;
let currentType = 'static';
let environments = [];
let editingEnvironmentId = null;
let tracingSettings = { ...DEFAULT_TRACING_SETTINGS };
let traceIds = { correlationId: '', attemptId: '' };
let scratchUuid = '';

// ── Init ──

document.addEventListener('DOMContentLoaded', async () => {
  await detectCurrentTab();
  environments = await getEnvironments();
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

  $selectEnvironment.addEventListener('change', applyEnvironmentSelection);

  $btnTrace.addEventListener('click', openTrace);
  $btnTraceBack.addEventListener('click', closeTrace);
  $btnCycleScratch.addEventListener('click', cycleScratchUuid);
  $btnCopyScratch.addEventListener('click', () => copyToClipboard($btnCopyScratch, scratchUuid, $scratchUuid));
  $btnUseScratch.addEventListener('click', useScratchAsCorrelationId);
  $btnCycleCorrelation.addEventListener('click', cycleCorrelationId);
  $btnCopyCorrelation.addEventListener('click', () => copyToClipboard($btnCopyCorrelation, traceIds.correlationId, $correlationId));
  $btnCycleAttempt.addEventListener('click', cycleAttemptId);
  $btnCopyAttempt.addEventListener('click', () => copyToClipboard($btnCopyAttempt, traceIds.attemptId, $attemptId));
  $btnSaveTracing.addEventListener('click', handleSaveTracing);

  $btnEnvironments.addEventListener('click', openEnvironments);
  $btnEnvironmentsBack.addEventListener('click', closeEnvironments);
  $btnAddEnvironment.addEventListener('click', () => openEnvironmentForm(null));
  $btnSaveEnvironment.addEventListener('click', handleSaveEnvironment);
  $btnCancelEnvironment.addEventListener('click', closeEnvironmentForm);

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

// The tab indicator and header buttons belong to the list; sub-screens reclaim
// their vertical space so a form fits in one view without scrolling.
function setListChromeVisible(visible) {
  $headerActions.classList.toggle('hidden', !visible);
  $currentTab.classList.toggle('hidden', !visible || !currentTabUrl);
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
  let environmentBadge = '';
  if (profile.type === 'oauth') {
    const config = resolveOAuthConfig(profile, environments);
    const token = await getCachedToken(profile.id).catch(() => null);
    const error = await getTokenError(profile.id);

    if (config.environmentName) {
      environmentBadge = `<span class="profile-badge env">${escapeHtml(config.environmentName)}</span>`;
    }

    if (config.error) {
      statusHtml = `<div class="profile-status error">✗ ${escapeHtml(config.error)}</div>`;
    } else if (error) {
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
        ${environmentBadge}
        ${profile.tracing ? '<span class="profile-badge trace">trace</span>' : ''}
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
  setListChromeVisible(false);
  $profileForm.classList.remove('hidden');

  populateEnvironmentSelect(profile?.environmentId || '');

  if (profile) {
    editingProfileId = profile.id;
    $formTitle.textContent = 'Edit Profile';
    $inputName.value = profile.name || '';
    $inputUrl.value = profile.urlPattern || '';
    $inputTracing.checked = Boolean(profile.tracing);
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
    $inputTracing.checked = false;
    setType('static');
    $headersList.innerHTML = '';
    addHeaderRow('', '');
    $inputTokenUrl.value = '';
    $inputClientId.value = '';
    $inputClientSecret.value = '';
  }

  applyEnvironmentSelection();
  $inputName.focus();
}

function closeForm() {
  $profileForm.classList.add('hidden');
  $profileList.classList.remove('hidden');
  setListChromeVisible(true);
  editingProfileId = null;
}

function setType(type) {
  currentType = type;
  $toggleStatic.classList.toggle('active', type === 'static');
  $toggleOAuth.classList.toggle('active', type === 'oauth');
  $sectionStatic.classList.toggle('hidden', type !== 'static');
  $sectionOAuth.classList.toggle('hidden', type !== 'oauth');
}

// ── Environment Selection (profile form) ──

function populateEnvironmentSelect(selectedId) {
  $selectEnvironment.innerHTML = '';

  const custom = document.createElement('option');
  custom.value = '';
  custom.textContent = 'Custom (enter manually)';
  $selectEnvironment.appendChild(custom);

  for (const environment of environments) {
    const option = document.createElement('option');
    option.value = environment.id;
    option.textContent = environment.name || 'Unnamed';
    $selectEnvironment.appendChild(option);
  }

  // A profile can still point at an environment that has since been deleted
  if (selectedId && !findEnvironment(environments, selectedId)) {
    const missing = document.createElement('option');
    missing.value = selectedId;
    missing.textContent = '⚠ Deleted environment';
    $selectEnvironment.appendChild(missing);
  }

  $selectEnvironment.value = selectedId;
}

function applyEnvironmentSelection() {
  const linked = Boolean($selectEnvironment.value);
  const environment = findEnvironment(environments, $selectEnvironment.value);

  $groupTokenUrl.classList.toggle('hidden', linked);
  $groupEnvTokenUrl.classList.toggle('hidden', !linked);
  if (environment) {
    $envTokenUrlDisplay.textContent = environment.tokenUrl || '—';
  } else if (linked) {
    $envTokenUrlDisplay.textContent = 'Environment no longer exists — pick another';
  }

  const secretFromEnvironment = Boolean(environment?.clientSecret);
  $groupClientSecret.classList.toggle('hidden', secretFromEnvironment);
  $groupEnvClientSecret.classList.toggle('hidden', !secretFromEnvironment);
  $clientSecretHint.classList.toggle('hidden', !linked || secretFromEnvironment);
  if (secretFromEnvironment) {
    $envSecretSource.textContent = environment.name || 'environment';
  }
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
  profile.tracing = $inputTracing.checked;

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
    const environmentId = $selectEnvironment.value || null;
    const environment = findEnvironment(environments, environmentId);

    if (environmentId && !environment) {
      alert('This profile points at an environment that no longer exists. Pick another one.');
      return;
    }

    profile.environmentId = environmentId;
    profile.clientId = $inputClientId.value.trim();
    // A linked profile stores nothing its environment already provides
    profile.tokenUrl = environment ? '' : $inputTokenUrl.value.trim();
    profile.clientSecret = environment?.clientSecret ? '' : $inputClientSecret.value.trim();

    if (!profile.clientId) {
      alert('Client ID is required for OAuth profiles.');
      return;
    }
    if (!environment && !profile.tokenUrl) {
      alert('Token URL is required for OAuth profiles.');
      return;
    }
    if (!environment?.clientSecret && !profile.clientSecret) {
      alert('Client Secret is required for OAuth profiles.');
      return;
    }
  }

  await saveProfile(profile);
  closeForm();
  await renderProfiles();
}

// ── Environments Screen ──

async function openEnvironments() {
  environments = await getEnvironments();
  $profileList.classList.add('hidden');
  setListChromeVisible(false);
  $environmentsScreen.classList.remove('hidden');
  closeEnvironmentForm();
  renderEnvironments();
}

async function closeEnvironments() {
  $environmentsScreen.classList.add('hidden');
  $profileList.classList.remove('hidden');
  setListChromeVisible(true);
  await renderProfiles();
}

function renderEnvironments() {
  $environmentList.innerHTML = '';
  $environmentsEmpty.classList.toggle('hidden', environments.length > 0);

  for (const environment of environments) {
    $environmentList.appendChild(createEnvironmentCard(environment));
  }
}

function createEnvironmentCard(environment) {
  const card = document.createElement('div');
  card.className = 'environment-card';

  card.innerHTML = `
    <div class="environment-info">
      <div class="environment-name">${escapeHtml(environment.name || 'Unnamed')}</div>
      <div class="environment-url">${escapeHtml(environment.tokenUrl || '—')}</div>
      <div class="environment-secret ${environment.clientSecret ? 'has-secret' : ''}">${environment.clientSecret ? '● Secret saved' : '○ No shared secret'}</div>
      <div class="environment-warning hidden"></div>
    </div>
    <div class="profile-actions">
      <button class="btn-icon settings" data-action="edit" title="Edit"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      <button class="btn-icon" data-action="delete" title="Delete"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `;

  card.querySelector('.environment-info').addEventListener('click', () => openEnvironmentForm(environment));
  card.querySelector('[data-action="edit"]').addEventListener('click', () => openEnvironmentForm(environment));

  const deleteBtn = card.querySelector('[data-action="delete"]');
  const warning = card.querySelector('.environment-warning');

  deleteBtn.addEventListener('click', async () => {
    if (deleteBtn.classList.contains('confirm-delete')) {
      await deleteEnvironment(environment.id);
      environments = await getEnvironments();
      renderEnvironments();
      return;
    }

    // First click arms the delete and names whatever would break
    const profiles = await getProfiles();
    const linked = profiles.filter(p => p.environmentId === environment.id);
    if (linked.length > 0) {
      warning.textContent = `Used by ${linked.map(p => p.name || 'Unnamed').join(', ')} — they will stop working until repointed.`;
      warning.classList.remove('hidden');
    }

    deleteBtn.classList.add('confirm-delete');
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg><span class="confirm-label">Confirm delete</span>`;

    setTimeout(() => {
      if (!deleteBtn.classList.contains('confirm-delete')) return;
      deleteBtn.classList.remove('confirm-delete');
      deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      warning.classList.add('hidden');
    }, 3000);
  });

  return card;
}

function openEnvironmentForm(environment) {
  editingEnvironmentId = environment?.id || null;
  $environmentFormTitle.textContent = environment ? 'Edit Environment' : 'New Environment';
  $inputEnvName.value = environment?.name || '';
  $inputEnvTokenUrl.value = environment?.tokenUrl || '';
  $inputEnvClientSecret.value = environment?.clientSecret || '';

  $environmentForm.classList.remove('hidden');
  $environmentList.classList.add('hidden');
  $environmentsEmpty.classList.add('hidden');
  $btnAddEnvironment.classList.add('hidden');
  $inputEnvName.focus();
}

function closeEnvironmentForm() {
  editingEnvironmentId = null;
  $environmentForm.classList.add('hidden');
  $environmentList.classList.remove('hidden');
  $btnAddEnvironment.classList.remove('hidden');
  $environmentsEmpty.classList.toggle('hidden', environments.length > 0);
}

async function handleSaveEnvironment() {
  const name = $inputEnvName.value.trim();
  const tokenUrl = $inputEnvTokenUrl.value.trim();

  if (!name || !tokenUrl) {
    alert('Name and Token URL are required.');
    return;
  }

  const environment = editingEnvironmentId
    ? findEnvironment(environments, editingEnvironmentId) || createEmptyEnvironment()
    : createEmptyEnvironment();
  if (editingEnvironmentId) environment.id = editingEnvironmentId;

  environment.name = name;
  environment.tokenUrl = tokenUrl;
  environment.clientSecret = $inputEnvClientSecret.value.trim();

  await saveEnvironment(environment);
  environments = await getEnvironments();
  closeEnvironmentForm();
  renderEnvironments();
}

// ── Trace IDs Screen ──

async function openTrace() {
  tracingSettings = await getTracingSettings();
  traceIds = await ensureTraceIds();
  if (!scratchUuid) scratchUuid = newUuid();

  $profileList.classList.add('hidden');
  setListChromeVisible(false);
  $traceScreen.classList.remove('hidden');
  renderTrace();
}

async function closeTrace() {
  $traceScreen.classList.add('hidden');
  $profileList.classList.remove('hidden');
  setListChromeVisible(true);
  await renderProfiles();
}

function renderTrace() {
  $scratchUuid.textContent = scratchUuid;
  $correlationId.textContent = traceIds.correlationId;
  $attemptId.textContent = traceIds.attemptId;
  $inputCorrelationHeader.value = tracingSettings.correlationHeader;
  $inputAttemptHeader.value = tracingSettings.attemptHeader;
}

function cycleScratchUuid() {
  scratchUuid = newUuid();
  renderTrace();
}

// A new correlation ID begins a new trace, so the attempt starts over with it
async function cycleCorrelationId() {
  traceIds = await setTraceIds({ correlationId: newUuid(), attemptId: newUuid() });
  renderTrace();
}

async function cycleAttemptId() {
  traceIds = await setTraceIds({ ...traceIds, attemptId: newUuid() });
  renderTrace();
}

async function useScratchAsCorrelationId() {
  traceIds = await setTraceIds({ correlationId: scratchUuid, attemptId: newUuid() });
  renderTrace();
}

async function handleSaveTracing() {
  const correlationHeader = $inputCorrelationHeader.value.trim() || DEFAULT_TRACING_SETTINGS.correlationHeader;
  const attemptHeader = $inputAttemptHeader.value.trim() || DEFAULT_TRACING_SETTINGS.attemptHeader;

  for (const name of [correlationHeader, attemptHeader]) {
    if (!isValidHeaderName(name)) {
      alert(`"${name}" is not a valid header name. Use letters, digits and - _ . without spaces.`);
      return;
    }
  }

  tracingSettings = await saveTracingSettings({ correlationHeader, attemptHeader });
  renderTrace();

  const label = $btnSaveTracing.textContent;
  $btnSaveTracing.textContent = 'Saved';
  $btnSaveTracing.disabled = true;
  setTimeout(() => {
    $btnSaveTracing.textContent = label;
    $btnSaveTracing.disabled = false;
  }, 1200);
}

async function copyToClipboard(button, text, valueElement) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Leave the value selected so it is still one keystroke away
    selectText(valueElement);
    return;
  }

  const original = button.innerHTML;
  button.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  setTimeout(() => { button.innerHTML = original; }, 1200);
}

function selectText(element) {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
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
