(function attachDashboardControls(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DashboardControls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDashboardControls() {
  'use strict';

  const CLEAR_LOCAL_INVENTORY_CONFIRMATION =
    'Clear local conversation inventory?\n\n' +
    'This removes only the manager\'s local conversation list and preserves Manager ' +
    'settings and deletion-job state. It does not delete any ChatGPT conversations.';

  function renderAdvancedState(button, panel, icon, expanded) {
    panel.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-controls', panel.id);
    icon.textContent = expanded ? '▴' : '▾';
  }

  function bindAdvancedToggle({ button, panel, icon }) {
    if (!button || typeof button.addEventListener !== 'function') {
      throw new TypeError('Advanced toggle button is required');
    }
    if (!panel || typeof panel.id !== 'string' || panel.id === '') {
      throw new TypeError('Advanced controlled panel is required');
    }
    if (!icon || !('textContent' in icon)) {
      throw new TypeError('Advanced toggle icon is required');
    }

    renderAdvancedState(button, panel, icon, !panel.hidden);
    const handleClick = () => {
      const expanded = panel.hidden;
      renderAdvancedState(button, panel, icon, expanded);
    };
    button.addEventListener('click', handleClick);
    return () => button.removeEventListener?.('click', handleClick);
  }

  async function clearLocalInventory({
    confirmImpl,
    store
  }) {
    if (typeof confirmImpl !== 'function') {
      throw new TypeError('confirmImpl must be a function');
    }
    if (!store || typeof store.clearAll !== 'function') {
      throw new TypeError('store must provide clearAll');
    }
    if (!confirmImpl(CLEAR_LOCAL_INVENTORY_CONFIRMATION)) {
      return { cleared: false };
    }

    await store.clearAll();
    return { cleared: true };
  }

  return {
    CLEAR_LOCAL_INVENTORY_CONFIRMATION,
    bindAdvancedToggle,
    clearLocalInventory
  };
});
