'use strict';

importScripts(
  'runtime-identity.js',
  'timestamp-utils.js',
  'search-core.js',
  'conversation-policy.js',
  'deletion-core.js',
  'delete-job.js',
  'job-store.js',
  'db.js',
  'delete-job-executor.js',
  'job-controller.js',
  'background-runtime.js'
);

console.info('ChatGPT Manager service worker:', RuntimeIdentity.formatMarker());

async function acquireSessionToken() {
  const response = await fetch('https://chatgpt.com/api/auth/session', {
    credentials: 'include'
  });
  if (!response.ok) throw new Error('Session unavailable');
  const session = await response.json();
  if (typeof session?.accessToken !== 'string' || session.accessToken === '') {
    throw new Error('Session unavailable');
  }
  return session.accessToken;
}

function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ url: dashboardUrl }, tabs => {
      if (chrome.runtime.lastError) {
        reject(new Error('Unable to query dashboard tabs'));
        return;
      }
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: dashboardUrl });
      }
      resolve();
    });
  });
}

const jobStore = JobStore.createJobStore({ storageArea: chrome.storage.local });
const executor = DeleteJobExecutor.createDeleteJobExecutor({
  jobStore,
  inventory: chatDB,
  alarms: chrome.alarms,
  acquireSessionToken,
  fetchImpl: (...args) => fetch(...args)
});
const controller = DeleteJobController.createDeleteJobController({
  jobStore,
  inventory: chatDB,
  executor
});
const runtime = BackgroundRuntime.createBackgroundRuntime({
  chromeApi: chrome,
  controller,
  executor,
  openDashboard
});

runtime.register();
