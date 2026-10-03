'use strict';

let accessToken = null;
let allChats = [];
let visibleChats = [];
let selectedIds = new Set();
let currentSort = { column: 'updated', direction: 'desc' };
let isHistorySyncing = false;
let searchAbortController = null;
let eligibilityAbortController = null;
let lastDiagnosticReport = null;
let lastEligibilityDiagnosticReport = null;
let currentDeleteJob = null;
let lastCompletedCount = 0;
let deleteWorkflow = null;
let resumeReviewOpen = false;
let jobCountdownTimer = null;
let managerWorkspace = null;

const DELETE_INTERVAL_STORAGE_KEY = 'delete_interval_seconds';

const elements = DashboardDom.bindDashboardElements(document);
const runtimeMarker = RuntimeIdentity.formatMarker();
elements['runtime-build-marker'].textContent = runtimeMarker;
console.info('ChatGPT Manager dashboard:', runtimeMarker);
const jobClient = JobClient.createJobClient({
  runtime: chrome.runtime,
  storage: chrome.storage,
  onChange: handleDeleteJobChange
});

const sortableControls = [
  {
    header: elements['sort-title-header'],
    icon: elements['sort-title-icon']
  },
  {
    header: elements['sort-type-header'],
    icon: elements['sort-type-icon']
  },
  {
    header: elements['sort-updated-header'],
    icon: elements['sort-updated-icon']
  }
];

async function init() {
  await chatDB.init();
  await initializeManagerMetadata();
  await loadDeleteIntervalSetting();
  setupEventListeners();
  await loadAndRender();
  try {
    await jobClient.connect();
  } catch (_error) {
    elements['history-status'].textContent =
      'Stored deletion state needs review. No deletion was started.';
  }
  await fetchAccessToken();
}

function setupEventListeners() {
  elements['sync-btn'].addEventListener('click', syncConversations);
  elements['history-load-btn'].addEventListener('click', syncConversations);
  elements['history-rebuild-btn'].addEventListener('click', rebuildInventoryFromChatGPT);
  elements['history-recover-search-btn'].addEventListener('click', focusContentSearchRecovery);
  DashboardControls.bindAdvancedToggle({
    button: elements['advanced-toggle-btn'],
    panel: elements['advanced-panel'],
    icon: elements['advanced-toggle-icon']
  });
  elements['search-sync-btn'].addEventListener('click', startSearchSync);
  elements['search-sync-cancel-btn'].addEventListener('click', cancelSearchSync);
  elements['diagnostic-run-btn'].addEventListener('click', runReadOnlyDiagnostic);
  elements['diagnostic-copy-btn'].addEventListener('click', copyDiagnosticReport);
  elements['eligibility-verify-batch-btn'].addEventListener(
    'click',
    startEligibilityBatch
  );
  elements['eligibility-cancel-btn'].addEventListener(
    'click',
    cancelEligibilityVerification
  );
  elements['eligibility-copy-btn'].addEventListener(
    'click',
    copyEligibilityDiagnostic
  );
  elements['clear-db-btn'].addEventListener('click', clearLocalInventory);
  elements['delete-interval-input'].addEventListener(
    'change',
    saveDeleteIntervalSetting
  );

  for (const id of [
    'search-input',
    'type-filter',
    'updated-from',
    'updated-to',
    'status-filter'
  ]) {
    const eventName = id === 'search-input' ? 'input' : 'change';
    elements[id].addEventListener(eventName, renderWorkspace);
  }

  sortableControls.forEach(({ header, icon }) => {
    header.addEventListener('click', () => {
      const column = header.dataset.sort;
      if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { column, direction: column === 'title' ? 'asc' : 'desc' };
      }
      sortableControls.forEach(item => { item.icon.textContent = ''; });
      icon.textContent = currentSort.direction === 'asc' ? '▲' : '▼';
      renderWorkspace();
    });
  });

  elements['select-all-checkbox'].addEventListener('change', event => {
    const visibleIds = InventoryWorkspace.selectVisibleIds(visibleChats);
    for (const id of visibleIds) {
      if (event.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
    }
    renderTable(visibleChats);
  });

  elements['deselect-btn'].addEventListener('click', () => {
    selectedIds.clear();
    renderTable(visibleChats);
  });
  managerWorkspace?.bind();
  elements['delete-selected-btn'].addEventListener('click', openDeleteConfirmation);
  elements['cancel-delete-confirm-btn'].addEventListener('click', cancelDeleteWorkflow);
  elements['confirm-delete-btn'].addEventListener('click', startDeletePlan);
  elements['approve-projects-btn'].addEventListener('click', approveReviewProjects);
  elements['retry-unresolved-btn'].addEventListener('click', retryDeletePreparation);
  elements['exclude-unresolved-btn'].addEventListener('click', () => {
    excludeDeleteReviewCategory('unresolved');
  });
  elements['exclude-custom-gpt-btn'].addEventListener('click', () => {
    excludeDeleteReviewCategory('custom_gpt');
  });
  elements['delete-review-continue-btn'].addEventListener('click', showDeleteStart);
  elements['delete-start-back-btn'].addEventListener('click', renderDeleteReview);
  elements['active-job-pause-btn'].addEventListener('click', pauseDeleteJob);
  elements['active-job-resume-btn'].addEventListener('click', resumeDeleteJob);
  elements['active-job-review-btn'].addEventListener('click', viewDeleteJob);
  elements['active-job-cancel-btn'].addEventListener('click', cancelRemainingJob);
  elements['active-job-view-btn'].addEventListener('click', viewDeleteJob);
  elements['fixed-job-pause-btn'].addEventListener('click', pauseDeleteJob);
  elements['fixed-job-resume-btn'].addEventListener('click', resumeDeleteJob);
  elements['fixed-job-details-btn'].addEventListener('click', viewDeleteJob);
  elements['recent-job-dismiss-btn'].addEventListener('click', dismissRecentJob);
}

async function initializeManagerMetadata() {
  try {
    await managerMetaDB.init();
    managerWorkspace = ManagerWorkspaceUI.createController({
      document, elements, store: managerMetaDB,
      getRecords: () => allChats, getSelectedIds: () => new Set(selectedIds),
      onViewChanged: () => renderWorkspace(), confirmImpl: confirm
    });
    await managerWorkspace.refresh({ notify: false });
  } catch (error) {
    console.warn('Manager metadata unavailable:', error.message);
    elements['manager-metadata-status'].textContent =
      'Local organization is unavailable. History and Delete remain independent.';
    for (const id of ['new-collection-btn','add-to-collection-btn','collection-filter',
      'new-tag-btn','tag-selected-btn','tag-filter']) elements[id].disabled = true;
  }
}

async function fetchAccessToken() {
  try {
    const response = await fetch('https://chatgpt.com/api/auth/session');
    if (!response.ok) throw new Error('Not logged in');
    const session = await response.json();
    accessToken = session.accessToken;
    if (!accessToken) throw new Error('No token found');
  } catch (error) {
    console.warn('Unable to acquire the in-browser ChatGPT session:', error.message);
    elements['history-status'].textContent =
      'Log in to ChatGPT, then reload this page to load or change conversations.';
  }
}

function setHistoryControlsDisabled(disabled) {
  elements['sync-btn'].disabled = disabled;
  elements['history-load-btn'].disabled = disabled;
  elements['history-maximum-input'].disabled = disabled;
  elements['history-rebuild-btn'].disabled = disabled;
}

async function syncConversations() {
  if (isHistorySyncing) return;
  if (!accessToken) {
    elements['history-status'].textContent =
      'History cannot load until the in-browser ChatGPT session is available.';
    return;
  }

  let maximum;
  try {
    maximum = HistorySync.parseMaximum(elements['history-maximum-input'].value);
  } catch (_error) {
    elements['history-status'].textContent =
      'Maximum conversations must be a positive whole number or All.';
    elements['history-maximum-input'].focus();
    return;
  }

  isHistorySyncing = true;
  setHistoryControlsDisabled(true);
  elements['history-recover-search-btn'].hidden = true;
  elements['history-status'].textContent = 'Loading history…';

  try {
    const summary = await HistorySync.runHistorySync({
      maximum,
      store: chatDB,
      authToken: accessToken,
      onProgress(progress) {
        if (progress.phase === 'page') {
          elements['history-status'].textContent =
            `Loading history — ${progress.fetched} fetched · ` +
            `${progress.inserted} added · ${progress.updated} updated · ` +
            `${progress.unchanged} unchanged`;
        }
      }
    });
    elements['history-status'].textContent =
      DashboardView.formatHistoryStatus(summary);
    elements['history-recover-search-btn'].hidden =
      !DashboardView.shouldOfferSearchRecovery(summary);
    await loadAndRender();
    elements['history-inventory-status'].textContent =
      DashboardView.formatHistoryDetails(summary);
  } catch (error) {
    console.warn('History loading stopped:', error.message);
    elements['history-status'].textContent =
      'History could not be loaded. Your existing conversations were kept.';
    elements['history-recover-search-btn'].hidden = false;
    await updateInventoryCount();
  } finally {
    isHistorySyncing = false;
    setHistoryControlsDisabled(false);
  }
}

async function rebuildInventoryFromChatGPT() {
  if (isHistorySyncing) return;
  if (!accessToken) {
    elements['history-status'].textContent =
      'Inventory cannot rebuild until the in-browser ChatGPT session is available.';
    return;
  }
  if (isNonTerminalJob(currentDeleteJob)) {
    elements['history-status'].textContent =
      'Pause or cancel the active deletion job before rebuilding the conversation inventory.';
    return;
  }
  if (!confirm(InventoryResync.REBUILD_CONFIRMATION)) return;

  isHistorySyncing = true;
  setHistoryControlsDisabled(true);
  elements['history-recover-search-btn'].hidden = true;
  elements['history-status'].textContent =
    'Rebuilding inventory — clearing the local conversation list…';

  try {
    const summary = await InventoryResync.rebuildInventory({
      store: chatDB,
      authToken: accessToken,
      onProgress(progress) {
        if (progress.phase === 'cleared') {
          selectedIds.clear();
          elements['history-inventory-status'].textContent =
            '0 conversations in local inventory · rebuilding';
        } else if (progress.phase === 'page') {
          elements['history-status'].textContent =
            `Rebuilding inventory — ${progress.fetched} conversations loaded…`;
          elements['history-inventory-status'].textContent =
            `${progress.fetched} conversations recovered so far`;
        }
      }
    });
    elements['history-status'].textContent =
      DashboardView.formatRebuildStatus(summary);
    elements['history-recover-search-btn'].hidden =
      !DashboardView.shouldOfferSearchRecovery(summary);
    await loadAndRender();
    elements['history-inventory-status'].textContent =
      DashboardView.formatRebuildDetails(summary);
  } catch (error) {
    console.warn('Inventory rebuild stopped:', error.message);
    elements['history-status'].textContent =
      'Inventory rebuild stopped unexpectedly. No ChatGPT conversations were deleted.';
    elements['history-recover-search-btn'].hidden = false;
    await loadAndRender();
  } finally {
    isHistorySyncing = false;
    setHistoryControlsDisabled(false);
  }
}

function focusContentSearchRecovery() {
  elements['search-status'].textContent =
    'Enter one or more explicit words or phrases. Content search will add matching ' +
    'conversations to the local inventory; it cannot guarantee a complete account inventory.';
  elements['search-queries-input'].focus();
  elements['search-queries-input'].scrollIntoView?.({
    behavior: 'smooth',
    block: 'center'
  });
}

async function startSearchSync() {
  if (searchAbortController) return;
  if (!accessToken) {
    elements['search-status'].textContent =
      'Content search requires the in-browser ChatGPT session.';
    return;
  }
  const queries = SearchSync.normalizeQueries(elements['search-queries-input'].value);
  if (queries.length === 0) {
    elements['search-status'].textContent =
      'Enter at least one word or phrase to find.';
    return;
  }

  searchAbortController = new AbortController();
  elements['search-sync-btn'].disabled = true;
  elements['search-sync-cancel-btn'].disabled = false;
  elements['search-status'].textContent = 'Finding conversations…';
  elements['search-sync-status'].textContent = 'Search started.';
  let latestProgress = {};

  try {
    const summary = await SearchSync.runSearchSync({
      queries,
      store: chatDB,
      signal: searchAbortController.signal,
      runQuery(query, options) {
        return SearchCore.runSearchQuery({
          query,
          authToken: accessToken,
          signal: options.signal,
          onProgress: options.onProgress
        });
      },
      onProgress(progress) {
        latestProgress = { ...latestProgress, ...progress };
        elements['search-sync-status'].textContent =
          DashboardView.formatSearchProgress(latestProgress);
      }
    });

    const queryLabel = queries.join(', ');
    if (summary.stop_reason === 'http_429') {
      elements['search-status'].textContent =
        `Search paused by ChatGPT. ${summary.unique_conversations} matching conversations ` +
        'were kept. Retry later.';
    } else if (summary.state === 'cancelled') {
      elements['search-status'].textContent =
        `Search stopped. ${summary.unique_conversations} matching conversations were kept.`;
    } else {
      elements['search-status'].textContent =
        DashboardView.formatSearchStatus(summary, queryLabel);
    }
    elements['search-sync-status'].textContent =
      DashboardView.formatSearchSummary(summary);
    await loadAndRender();
  } catch (error) {
    console.warn('Content search stopped:', error.message);
    elements['search-status'].textContent =
      'Search stopped safely. Existing local conversations were kept.';
  } finally {
    searchAbortController = null;
    elements['search-sync-btn'].disabled = false;
    elements['search-sync-cancel-btn'].disabled = true;
  }
}

function cancelSearchSync() {
  if (!searchAbortController) return;
  searchAbortController.abort();
  elements['search-status'].textContent = 'Stopping search…';
}

async function runReadOnlyDiagnostic() {
  const query = elements['diagnostic-query-input'].value.trim();
  if (!accessToken) {
    elements['diagnostic-status'].textContent =
      'Diagnostic requires the in-browser ChatGPT session.';
    return;
  }
  if (!query) {
    elements['diagnostic-status'].textContent = 'Enter one diagnostic query.';
    return;
  }

  elements['diagnostic-run-btn'].disabled = true;
  elements['diagnostic-copy-btn'].disabled = true;
  lastDiagnosticReport = null;
  elements['diagnostic-status'].textContent =
    'Running bounded read-only diagnostic…';
  try {
    lastDiagnosticReport = await SearchCore.runSearchDiagnostic({
      query,
      authToken: accessToken,
      maxPages: Number.parseInt(elements['diagnostic-pages-select'].value, 10)
    });
    elements['diagnostic-status'].textContent =
      JSON.stringify(lastDiagnosticReport, null, 2);
    elements['diagnostic-copy-btn'].disabled = false;
  } catch (error) {
    console.warn('Read-only diagnostic failed:', error.message);
    elements['diagnostic-status'].textContent =
      'Diagnostic stopped before a sanitized report could be produced.';
  } finally {
    elements['diagnostic-run-btn'].disabled = false;
  }
}

async function copyDiagnosticReport() {
  if (!lastDiagnosticReport) return;
  await copyText(
    JSON.stringify(lastDiagnosticReport, null, 2),
    elements['diagnostic-copy-btn'],
    'Copy sanitized report',
    elements['diagnostic-status']
  );
}

function unknownSearchIds() {
  return allChats
    .filter(EligibilityCore.isVerificationCandidate)
    .map(record => record.id)
    .slice(0, EligibilityCore.DEFAULT_MAX_VERIFICATIONS);
}

function setEligibilityControlsRunning(running) {
  elements['eligibility-verify-batch-btn'].disabled = running;
  elements['eligibility-cancel-btn'].disabled = !running;
  document.querySelectorAll('.verify-btn').forEach(button => {
    button.disabled = running;
  });
}

async function startEligibilityBatch() {
  await runEligibilityVerification(unknownSearchIds());
}

async function runEligibilityVerification(ids) {
  if (eligibilityAbortController) return;
  if (!accessToken) {
    elements['eligibility-status'].textContent =
      'Verification requires the in-browser ChatGPT session.';
    return;
  }
  if (!ids.length) {
    elements['eligibility-status'].textContent =
      'No unverified search results are queued.';
    return;
  }

  eligibilityAbortController = new AbortController();
  lastEligibilityDiagnosticReport = null;
  elements['eligibility-copy-btn'].disabled = true;
  setEligibilityControlsRunning(true);
  elements['eligibility-status'].textContent =
    `Eligibility: queued · progress 0/${ids.length}`;

  try {
    const result = await EligibilityCore.runEligibilityVerificationQueue({
      ids,
      store: chatDB,
      signal: eligibilityAbortController.signal,
      allowStandalonePromotion: EligibilityCore.LIVE_STANDALONE_PROMOTION_ENABLED,
      verifyOne(record, options) {
        return EligibilityCore.runEligibilityDiagnostic({
          conversationId: record.id,
          authToken: accessToken,
          signal: options.signal,
          allowStandalonePromotion: options.allowStandalonePromotion
        });
      },
      onProgress(progress) {
        elements['eligibility-status'].textContent =
          DashboardView.formatEligibilityProgress(progress);
      }
    });
    lastEligibilityDiagnosticReport = {
      state: result.state,
      stop_reason: result.stop_reason,
      queued: result.queued,
      processed: result.processed,
      verified_standalone: result.verified_standalone,
      protected_project: result.protected_project,
      protected_custom_gpt: result.protected_custom_gpt,
      still_unknown: result.still_unknown,
      failed: result.failed,
      rate_limited: result.rate_limited,
      skipped: result.skipped,
      retry_after_ms: result.retry_after_ms
    };
    elements['eligibility-status'].textContent =
      DashboardView.formatEligibilityProgress(result);
    elements['eligibility-copy-btn'].disabled = false;
  } catch (error) {
    console.warn('Verification stopped:', error.message);
    elements['eligibility-status'].textContent =
      'Verification stopped safely. Unverified conversations remain protected.';
  } finally {
    eligibilityAbortController = null;
    setEligibilityControlsRunning(false);
    await loadAndRender();
  }
}

function cancelEligibilityVerification() {
  if (!eligibilityAbortController) return;
  eligibilityAbortController.abort();
  elements['eligibility-status'].textContent =
    'Stopping verification. Unverified conversations remain protected…';
}

async function copyEligibilityDiagnostic() {
  if (!lastEligibilityDiagnosticReport) return;
  await copyText(
    JSON.stringify(lastEligibilityDiagnosticReport, null, 2),
    elements['eligibility-copy-btn'],
    'Copy diagnostic',
    elements['eligibility-status']
  );
}

async function copyText(text, button, originalLabel, statusElement) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = originalLabel;
    }, 2000);
  } catch (_error) {
    statusElement.textContent += '\nCopy failed; select the sanitized report above.';
  }
}

async function clearLocalInventory() {
  if (isNonTerminalJob(currentDeleteJob)) {
    elements['history-status'].textContent =
      'Pause or cancel the active deletion job before clearing the local inventory.';
    return;
  }
  const result = await DashboardControls.clearLocalInventory({
    confirmImpl: confirm,
    store: chatDB
  });
  if (!result.cleared) return;
  selectedIds.clear();
  elements['history-recover-search-btn'].hidden = true;
  elements['history-status'].textContent =
    'Local conversation inventory cleared. Manager settings and deletion-job state were preserved.';
  await loadAndRender();
}

async function loadDeleteIntervalSetting() {
  let value = DeletionCore.DEFAULT_DELETE_INTERVAL_SECONDS;
  try {
    const stored = await chrome.storage.local.get(DELETE_INTERVAL_STORAGE_KEY);
    value = stored[DELETE_INTERVAL_STORAGE_KEY];
  } catch (error) {
    console.warn('Unable to read the deletion delay:', error.message);
  }
  const seconds = DeletionCore.parseDeleteIntervalSeconds(value) ??
    DeletionCore.DEFAULT_DELETE_INTERVAL_SECONDS;
  elements['delete-interval-input'].value = String(seconds);
}

async function saveDeleteIntervalSetting() {
  const input = elements['delete-interval-input'];
  const seconds = DeletionCore.parseDeleteIntervalSeconds(input.value);
  if (seconds === null) {
    elements['delete-interval-status'].textContent =
      `Use at least ${DeletionCore.MIN_DELETE_INTERVAL_SECONDS} seconds.`;
    input.setCustomValidity(
      `Use at least ${DeletionCore.MIN_DELETE_INTERVAL_SECONDS} seconds.`
    );
    input.reportValidity();
    input.setCustomValidity('');
    return false;
  }
  try {
    await chrome.storage.local.set({ [DELETE_INTERVAL_STORAGE_KEY]: seconds });
    elements['delete-interval-status'].textContent = 'Saved for this browser.';
  } catch (error) {
    console.warn('Unable to save the deletion delay:', error.message);
    elements['delete-interval-status'].textContent =
      'Not saved; this deletion can still use the entered value.';
  }
  return true;
}

function configuredDeleteInterval() {
  const seconds = DeletionCore.parseDeleteIntervalSeconds(
    elements['delete-interval-input'].value
  );
  if (seconds === null) return null;
  return {
    seconds,
    milliseconds: DeletionCore.deleteIntervalSecondsToMs(seconds)
  };
}

function dateBoundary(value, endOfDay) {
  if (!value) return null;
  const time = new Date(
    `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`
  ).getTime();
  return Number.isFinite(time) ? time : null;
}

async function loadAndRender() {
  const records = await chatDB.getAllConversations();
  allChats = records.map(record =>
    ConversationPolicy.normalizeConversationRecord(record)
  );
  selectedIds = InventoryWorkspace.reconcileSelection(selectedIds, allChats);
  updateInventoryCount();
  if (managerWorkspace) await managerWorkspace.refresh({ notify: false });
  renderWorkspace();
}

function updateInventoryCount() {
  const count = allChats.length;
  const noun = count === 1 ? 'conversation' : 'conversations';
  elements['inventory-count'].textContent = `${count} ${noun}`;
  elements['history-inventory-status'].textContent =
    `${count} ${noun} in local inventory`;
}

function renderWorkspace() {
  visibleChats = InventoryWorkspace.filterRecords(allChats, {
    title: elements['search-input'].value,
    type: elements['type-filter'].value,
    status: elements['status-filter'].value,
    updatedFrom: dateBoundary(elements['updated-from'].value, false),
    updatedTo: dateBoundary(elements['updated-to'].value, true)
  });
  if (managerWorkspace) visibleChats = managerWorkspace.filter(visibleChats);
  sortRecords(visibleChats);
  renderTable(visibleChats);
}

function sortRecords(records) {
  records.sort((first, second) => {
    let comparison;
    if (currentSort.column === 'title') {
      comparison = compareText(first.title, second.title);
    } else if (currentSort.column === 'type') {
      comparison = compareText(
        DashboardView.classificationLabel(first.classification),
        DashboardView.classificationLabel(second.classification)
      );
    } else {
      comparison = TimestampUtils.compareTimestamps(
        first.update_time,
        second.update_time
      );
    }
    return currentSort.direction === 'asc' ? comparison : -comparison;
  });
}

function compareText(first, second) {
  return String(first || '').localeCompare(String(second || ''), undefined, {
    sensitivity: 'base'
  });
}

function renderTable(chats) {
  elements['chat-list-body'].textContent = '';
  const fragment = document.createDocumentFragment();

  for (const chat of chats) {
    const verificationCandidate = EligibilityCore.isVerificationCandidate(chat);
    const verificationLabel = DashboardView.verificationLabel(chat.classification);
    const verificationDescription = DashboardView.verificationDescription(
      chat.classification
    );
    const verificationAttributes = verificationDescription
      ? ` title="${escapeHtml(verificationDescription)}" ` +
        `aria-label="${escapeHtml(`${verificationLabel}. ${verificationDescription}`)}" ` +
        'tabindex="0"'
      : '';
    const row = document.createElement('tr');
    if (chat.classification === ConversationPolicy.CLASSIFICATIONS.UNKNOWN) {
      row.classList.add('unverified-row');
    }
    row.innerHTML = `
      <td class="select-column">
        <input type="checkbox" class="row-checkbox"
          value="${escapeHtml(chat.id)}"
          aria-label="Select ${escapeHtml(chat.title || 'Untitled conversation')}"
          ${selectedIds.has(chat.id) ? 'checked' : ''}>
      </td>
      <td>
        <a class="conversation-link"
          href="https://chatgpt.com/c/${encodeURIComponent(chat.id)}"
          target="_blank" rel="noopener noreferrer">
          ${escapeHtml(chat.title || 'Untitled conversation')}
        </a>
      </td>
      <td><span class="type-badge">${escapeHtml(
        DashboardView.classificationLabel(chat.classification)
      )}</span></td>
      <td><span class="date-text">${escapeHtml(
        DashboardView.formatConversationDate(chat.update_time)
      )}</span></td>
      <td class="archive-column">${managerWorkspace ? managerWorkspace.rowMetadata(chat) : 'Metadata unavailable'}</td>
      <td>
        <div class="row-status">
          <span class="${verificationDescription ? 'verification-help' : ''}"${verificationAttributes}
            data-tooltip="${escapeHtml(verificationDescription || '')}">${escapeHtml(verificationLabel)}</span>
          ${verificationCandidate
            ? `<button class="btn btn-link verify-btn" data-id="${escapeHtml(chat.id)}">Verify</button>`
            : ''}
        </div>
      </td>
    `;
    fragment.appendChild(row);
  }
  elements['chat-list-body'].appendChild(fragment);
  elements['empty-state'].classList.toggle('hidden', chats.length !== 0);

  document.querySelectorAll('.row-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', event => {
      if (event.target.checked) selectedIds.add(event.target.value);
      else selectedIds.delete(event.target.value);
      updateSelectionControls();
    });
  });
  document.querySelectorAll('.verify-btn').forEach(button => {
    button.addEventListener('click', event => {
      runEligibilityVerification([event.currentTarget.dataset.id]);
    });
  });
  updateSelectionControls();
}

function updateSelectionControls() {
  const visibleIds = InventoryWorkspace.selectVisibleIds(visibleChats);
  const selectedVisibleCount = [...visibleIds].filter(id => selectedIds.has(id)).length;
  elements['select-all-checkbox'].checked =
    visibleIds.size > 0 && selectedVisibleCount === visibleIds.size;
  elements['select-all-checkbox'].indeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.size;

  elements['selected-count-text'].textContent =
    DashboardView.formatSelectionCount(selectedIds.size);
  elements['action-banner'].classList.toggle('hidden', selectedIds.size === 0);
  elements['delete-selected-btn'].disabled = isNonTerminalJob(currentDeleteJob);
  elements['delete-selected-btn'].title = isNonTerminalJob(currentDeleteJob)
    ? 'Finish or cancel the active deletion job before planning another.'
    : '';
  managerWorkspace?.updateActions({ activeDeleteJob: isNonTerminalJob(currentDeleteJob) });
}

function isNonTerminalJob(job) {
  return Boolean(job) && ![
    DeleteJob.JOB_STATES.COMPLETED,
    DeleteJob.JOB_STATES.CANCELLED
  ].includes(job.state);
}

function restartJobCountdown() {
  if (jobCountdownTimer !== null) {
    clearInterval(jobCountdownTimer);
    jobCountdownTimer = null;
  }
  DeleteJobView.renderActiveJob(elements, currentDeleteJob, Date.now());
  if (
    currentDeleteJob?.state === DeleteJob.JOB_STATES.RUNNING &&
    Number.isFinite(currentDeleteJob.next_run_at)
  ) {
    jobCountdownTimer = setInterval(() => {
      DeleteJobView.renderActiveJob(elements, currentDeleteJob, Date.now());
    }, 1000);
  }
}

function handleDeleteJobChange(job, metadata = {}) {
  const priorCompleted = lastCompletedCount;
  currentDeleteJob = job;
  lastCompletedCount = job?.counts?.completed || 0;
  restartJobCountdown();
  updateSelectionControls();
  if (metadata.error_code === 'invalid_job_state') {
    elements['history-status'].textContent =
      'Stored deletion state is invalid. No deletion was started.';
  }
  if (lastCompletedCount > priorCompleted) {
    void loadAndRender();
  }
}

function setWizardHidden(id, hidden) {
  elements[id].hidden = hidden;
  elements[id].classList.toggle('hidden', hidden);
}

function showDeletePlan(job, { resumeReview = false } = {}) {
  deleteWorkflow = null;
  resumeReviewOpen = resumeReview &&
    job.state === DeleteJob.JOB_STATES.ERROR_PAUSED;
  currentDeleteJob = job;
  DeleteJobView.renderPlan(elements, job, allChats);
  elements['delete-stage-indicator'].textContent = 'Job details';
  setWizardHidden('delete-prepare-panel', true);
  setWizardHidden('delete-review-panel', true);
  setWizardHidden('delete-start-panel', false);
  setWizardHidden('delete-review-continue-btn', true);
  setWizardHidden('delete-start-back-btn', true);
  const canStart = job.state === DeleteJob.JOB_STATES.READY;
  setWizardHidden('confirm-delete-btn', !(canStart || resumeReviewOpen));
  if (resumeReviewOpen) {
    elements['delete-preflight-status'].textContent =
      job.last_error?.code === 'interrupted_request'
        ? 'The interrupted request’s remote outcome is unknown. Review the remaining plan carefully; Resume deletion will attempt that conversation again.'
        : elements['active-job-error'].textContent ||
          'Review the remaining plan before resuming deletion.';
    elements['confirm-delete-btn'].disabled = false;
    elements['confirm-delete-btn'].textContent = 'Resume deletion';
  }
  elements['cancel-delete-confirm-btn'].textContent = 'Close';
  elements['delete-interval-input'].value = String(job.interval_seconds);
  elements['progress-modal'].classList.remove('hidden');
}

function showJobControlError(error) {
  const messages = {
    active_job_exists: 'A deletion job already exists. Review it before creating another.',
    invalid_job_state: 'Stored deletion state needs review. Nothing was started.',
    no_active_job: 'There is no active deletion job.',
    job_not_terminal: 'Only a completed or cancelled deletion can be dismissed.',
    plan_not_ready: 'The reviewed deletion plan is no longer eligible. Nothing was started.',
    project_approval_required: 'The Project conversation subset changed and must be reviewed again.'
  };
  elements['history-status'].textContent =
    messages[error?.code] || 'The deletion job could not be changed safely.';
}

function renderDeletePreparationProgress(progress = {}) {
  const selected = progress.selected ?? deleteWorkflow?.selection_ids.length ?? 0;
  const already = progress.already_verified ?? 0;
  const candidates = progress.verification_candidates ?? Math.max(0, selected - already);
  const processed = progress.processed ?? 0;
  elements['delete-stage-indicator'].textContent = '1 Prepare → 2 Review → 3 Start';
  elements['delete-plan-summary'].textContent = `${selected} selected · ${already} already verified`;
  elements['delete-prepare-status'].textContent = progress.phase === 'requesting'
    ? `Verifying ${Math.min(processed + 1, candidates)} of ${candidates} remaining…`
    : progress.phase === 'waiting'
      ? `Verified ${processed} of ${candidates}. Waiting before the next check…`
      : 'Inspecting canonical evidence and preparing safe categories…';
  elements['delete-preflight-status'].textContent =
    'No deletion requests occur during preparation.';
  setWizardHidden('delete-prepare-panel', false);
  setWizardHidden('delete-review-panel', true);
  setWizardHidden('delete-start-panel', true);
  setWizardHidden('delete-review-continue-btn', true);
  setWizardHidden('delete-start-back-btn', true);
  setWizardHidden('confirm-delete-btn', true);
}

function projectTitles(ids) {
  const titles = new Map(allChats.map(record => [record.id, record.title || 'Untitled conversation']));
  return ids.map(id => titles.get(id) || id).join('\n');
}

function renderDeleteReview() {
  if (!deleteWorkflow?.review) return;
  deleteWorkflow.stage = 'review';
  elements['cancel-delete-confirm-btn'].textContent = 'Cancel';
  const review = deleteWorkflow.review;
  const summary = DeletePreparation.summarizeDeleteReview(review);
  elements['delete-stage-indicator'].textContent = '1 Prepare → 2 Review → 3 Start';
  elements['delete-plan-summary'].textContent = [
    `${summary.selected} total`,
    `${summary.standalone} Standalone`,
    `${summary.project} Project`
  ].join(' · ');
  elements['delete-review-standalone'].textContent =
    `${review.standalone_ids.length} Standalone · Ready`;
  elements['delete-review-project'].textContent =
    `${review.project_ids.length} Project conversations · ${summary.project_approval_required ? 'Extra approval required' : 'Approved or not included'}`;
  elements['delete-review-custom-gpt'].textContent =
    `${review.custom_gpt_ids.length} Custom GPT conversations · ${summary.custom_gpt_blocked ? 'Deletion not enabled' : 'Excluded'}`;
  elements['delete-review-unresolved'].textContent =
    `${review.unresolved_ids.length} Could not be verified · ${summary.unresolved_blocked ? 'Unresolved' : 'Excluded'}`;

  const rateLimited = review.preparation_state === 'rate-limited';
  const blockers = [];
  if (summary.unresolved_blocked) blockers.push(`${summary.unresolved_blocked} unresolved`);
  if (summary.custom_gpt_blocked) blockers.push(`${summary.custom_gpt_blocked} Custom GPT blocked`);
  if (summary.project_approval_required) blockers.push('Project approval required');
  const sessionUnavailable = review.preparation_state === 'partial' &&
    deleteWorkflow?.result?.stop_reason === 'session_unavailable';
  elements['delete-preflight-status'].textContent = rateLimited
    ? 'Verification was rate-limited. Retry later or exclude unresolved conversations.'
    : sessionUnavailable
      ? 'Verification stopped because the ChatGPT session is unavailable. Log in or reload ChatGPT, then retry verification.'
      : blockers.length
      ? `Resolve before Start: ${blockers.join(' · ')}`
      : 'Review complete. Continue to the final Start step.';

  const hasProjects = review.project_ids.length > 0;
  setWizardHidden('delete-project-warning', !hasProjects);
  setWizardHidden('delete-project-list', !hasProjects);
  elements['delete-project-warning'].textContent = hasProjects
    ? 'These conversations belong to ChatGPT Projects. Deleting them permanently removes the selected conversations. Their Projects are not being deleted.'
    : '';
  elements['delete-project-list'].textContent = projectTitles(review.project_ids);
  setWizardHidden('retry-unresolved-btn', review.unresolved_ids.length === 0);
  setWizardHidden('exclude-unresolved-btn', summary.unresolved_blocked === 0);
  setWizardHidden('exclude-custom-gpt-btn', summary.custom_gpt_blocked === 0);
  setWizardHidden('approve-projects-btn', !summary.project_approval_required);
  setWizardHidden('remove-blocked-btn', true);
  elements['approve-projects-btn'].textContent =
    `Approve ${review.project_ids.length} Project conversation${review.project_ids.length === 1 ? '' : 's'}`;
  setWizardHidden('delete-prepare-panel', true);
  setWizardHidden('delete-review-panel', false);
  setWizardHidden('delete-start-panel', true);
  setWizardHidden('delete-review-continue-btn', false);
  elements['delete-review-continue-btn'].disabled = !summary.ready_for_start;
  setWizardHidden('delete-start-back-btn', true);
  setWizardHidden('confirm-delete-btn', true);
}

async function runDeletePreparation() {
  const workflow = deleteWorkflow;
  if (!workflow) return;
  workflow.abortController = new AbortController();
  renderDeletePreparationProgress();
  try {
    const result = await DeletePreparation.prepareDeleteSelection({
      ids: workflow.selection_ids,
      store: chatDB,
      signal: workflow.abortController.signal,
      verifyOne(record, options) {
        if (!accessToken) {
          const error = new Error('Session unavailable');
          error.code = 'session_unavailable';
          throw error;
        }
        return EligibilityCore.runEligibilityDiagnostic({
          conversationId: record.id,
          authToken: accessToken,
          signal: options.signal,
          allowStandalonePromotion: options.allowStandalonePromotion
        });
      },
      onProgress: renderDeletePreparationProgress
    });
    if (deleteWorkflow !== workflow) return;
    workflow.result = result;
    workflow.review = DeletePreparation.createDeleteReview(result);
    workflow.abortController = null;
    await loadAndRender();
    renderDeleteReview();
  } catch (error) {
    if (deleteWorkflow !== workflow || error?.name === 'AbortError') return;
    workflow.abortController = null;
    elements['delete-preflight-status'].textContent =
      'Preparation stopped safely. No deletion job was created.';
  }
}

async function openDeleteConfirmation() {
  if (selectedIds.size === 0) return;
  if (isNonTerminalJob(currentDeleteJob)) {
    showDeletePlan(currentDeleteJob);
    return;
  }
  deleteWorkflow = {
    selection_ids: [...selectedIds],
    review: null,
    result: null,
    abortController: null,
    stage: 'prepare'
  };
  elements['cancel-delete-confirm-btn'].textContent = 'Cancel preparation';
  elements['progress-modal'].classList.remove('hidden');
  await runDeletePreparation();
}

function closeDeleteModal() {
  resumeReviewOpen = false;
  elements['progress-modal'].classList.add('hidden');
}

async function cancelDeleteWorkflow() {
  if (deleteWorkflow) {
    deleteWorkflow.abortController?.abort();
    deleteWorkflow = null;
    closeDeleteModal();
    return;
  }
  if (currentDeleteJob && [
    DeleteJob.JOB_STATES.DRAFT,
    DeleteJob.JOB_STATES.READY
  ].includes(currentDeleteJob.state)) {
    try {
      await jobClient.cancel();
    } catch (error) {
      showJobControlError(error);
      return;
    }
  }
  closeDeleteModal();
}

async function retryDeletePreparation() {
  if (!deleteWorkflow || deleteWorkflow.abortController) return;
  deleteWorkflow.review = null;
  await runDeletePreparation();
}

function excludeDeleteReviewCategory(category) {
  if (!deleteWorkflow?.review) return;
  deleteWorkflow.review = DeletePreparation.excludeReviewCategory(
    deleteWorkflow.review,
    category
  );
  renderDeleteReview();
}

function approveReviewProjects() {
  if (!deleteWorkflow?.review) return;
  deleteWorkflow.review = DeletePreparation.approveProjectReview(deleteWorkflow.review);
  renderDeleteReview();
}

async function showDeleteStart() {
  if (!deleteWorkflow?.review) return;
  const summary = DeletePreparation.summarizeDeleteReview(deleteWorkflow.review);
  if (!summary.ready_for_start) return;
  const deleteInterval = configuredDeleteInterval();
  if (!deleteInterval) {
    await saveDeleteIntervalSetting();
    return;
  }
  deleteWorkflow.stage = 'start';
  elements['delete-stage-indicator'].textContent = '1 Prepare → 2 Review → 3 Start';
  elements['delete-plan-summary'].textContent = [
    `Delete ${summary.included_ids.length} conversations?`,
    `${summary.standalone} Standalone`,
    `${summary.project} Project approved`,
    `Target delay: ${deleteInterval.seconds} seconds`,
    `Estimated minimum wait: ${DeleteJobView.formatDurationSeconds(
      DeleteJob.estimateMinimumDurationSeconds(summary.included_ids.length, deleteInterval.seconds)
    )}`
  ].join(' · ');
  elements['delete-preflight-status'].textContent =
    'Once started, no further approval prompts appear. Pause or cancel the remaining job at any time.';
  setWizardHidden('delete-prepare-panel', true);
  setWizardHidden('delete-review-panel', true);
  setWizardHidden('delete-start-panel', false);
  setWizardHidden('delete-fast-timing-warning', deleteInterval.seconds >= 30);
  setWizardHidden('delete-review-continue-btn', true);
  setWizardHidden('delete-start-back-btn', false);
  setWizardHidden('confirm-delete-btn', false);
  elements['confirm-delete-btn'].disabled = false;
}

async function startDeletePlan() {
  if (!deleteWorkflow) {
    const shouldResume = resumeReviewOpen &&
      currentDeleteJob?.state === DeleteJob.JOB_STATES.ERROR_PAUSED;
    if (!shouldResume && currentDeleteJob?.state !== DeleteJob.JOB_STATES.READY) return;
    try {
      const job = shouldResume
        ? await jobClient.resume()
        : await jobClient.start();
      if (job.state === DeleteJob.JOB_STATES.RUNNING) closeDeleteModal();
      else showDeletePlan(job);
    } catch (error) {
      showJobControlError(error);
    }
    return;
  }
  if (deleteWorkflow.stage !== 'start') return;
  const summary = DeletePreparation.summarizeDeleteReview(deleteWorkflow.review);
  const deleteInterval = configuredDeleteInterval();
  if (!summary.ready_for_start || !deleteInterval) return;
  try {
    await saveDeleteIntervalSetting();
    await jobClient.startPlan({
      ids: summary.included_ids,
      intervalSeconds: deleteInterval.seconds,
      approvedProjectIds: summary.approved_project_ids
    });
    for (const id of summary.included_ids) selectedIds.delete(id);
    deleteWorkflow = null;
    closeDeleteModal();
    renderWorkspace();
  } catch (error) {
    showJobControlError(error);
  }
}
async function pauseDeleteJob() {
  try {
    await jobClient.pause();
  } catch (error) {
    showJobControlError(error);
  }
}

async function resumeDeleteJob() {
  if (currentDeleteJob?.state === DeleteJob.JOB_STATES.ERROR_PAUSED) {
    showDeletePlan(currentDeleteJob, { resumeReview: true });
    return;
  }
  try {
    const job = await jobClient.resume();
    if (job.state !== DeleteJob.JOB_STATES.RUNNING) showDeletePlan(job);
  } catch (error) {
    showJobControlError(error);
  }
}

async function cancelRemainingJob() {
  if (!currentDeleteJob) return;
  const remaining = currentDeleteJob.counts.pending;
  const confirmed = confirm(
    `Cancel remaining ${remaining} deletions?\n\n` +
    `${currentDeleteJob.counts.completed} completed deletions cannot be undone. ` +
    'The remaining conversations will not be deleted.'
  );
  if (!confirmed) return;
  try {
    await jobClient.cancel();
    closeDeleteModal();
  } catch (error) {
    showJobControlError(error);
  }
}

async function dismissRecentJob() {
  if (!currentDeleteJob || isNonTerminalJob(currentDeleteJob)) return;
  try {
    await jobClient.dismissTerminal();
  } catch (error) {
    showJobControlError(error);
  }
}

function viewDeleteJob() {
  if (currentDeleteJob) showDeletePlan(currentDeleteJob);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function reportDashboardInitializationFailure(error) {
  console.error('ChatGPT Manager dashboard initialization failed:', error);
  elements['history-status'].textContent =
    'Dashboard initialization failed. Reload this extension page and check the dashboard console.';
}

const dashboardInitialization = init();
globalThis.__CHATGPT_MANAGER_DASHBOARD_INITIALIZATION__ = dashboardInitialization;
dashboardInitialization.catch(reportDashboardInitializationFailure);
