(function attachInventoryResync(root, factory) {
  const historySync =
    typeof module === 'object' && module.exports
      ? require('./history-sync.js')
      : root.HistorySync;
  const api = factory(historySync);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.InventoryResync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createInventoryResync(
  historySync
) {
  'use strict';

  if (!historySync) throw new Error('HistorySync is required');

  const REBUILD_PAGE_SIZE = 10;
  const REBUILD_PAGE_DELAY_MS = 500;
  const REBUILD_CONFIRMATION =
    'Rebuild the local conversation inventory?\n\n' +
    'This clears only the manager\'s local conversation list, then reloads History ' +
    'from the beginning. Settings and deletion-job state are preserved. No ChatGPT ' +
    'conversation is deleted.\n\n' +
    'If ChatGPT stops the reload, the rebuilt inventory may be partial or empty. ' +
    'You can use explicit Search terms afterward to recover matching conversations.';

  async function rebuildInventory({
    store,
    authToken,
    fetchImpl = globalThis.fetch,
    signal = null,
    onProgress = () => {},
    now = Date.now,
    sleep
  }) {
    if (!store || typeof store.clearAll !== 'function') {
      throw new TypeError('Inventory rebuild store must provide clearAll');
    }
    if (typeof onProgress !== 'function') {
      throw new TypeError('Inventory rebuild onProgress must be a function');
    }

    await store.clearAll();
    onProgress({
      phase: 'cleared',
      state: 'running',
      fetched: 0,
      total_local: 0
    });
    return historySync.runHistorySync({
      maximum: null,
      store,
      authToken,
      fetchImpl,
      signal,
      onProgress,
      now,
      pageSize: REBUILD_PAGE_SIZE,
      pageDelayMs: REBUILD_PAGE_DELAY_MS,
      ...(sleep ? { sleep } : {})
    });
  }

  return {
    REBUILD_CONFIRMATION,
    REBUILD_PAGE_DELAY_MS,
    REBUILD_PAGE_SIZE,
    rebuildInventory
  };
});
