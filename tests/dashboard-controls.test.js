'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLEAR_LOCAL_INVENTORY_CONFIRMATION,
  bindAdvancedToggle,
  clearLocalInventory
} = require('../dashboard-controls.js');

class FakeButton {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.icon = { textContent: '' };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    return selector === '[data-advanced-icon]' ? this.icon : null;
  }

  click() {
    this.listeners.get('click')?.();
  }
}

test('Advanced toggles in place without changing workspace position', () => {
  const button = new FakeButton();
  const scrollCalls = [];
  const panel = {
    id: 'advanced-panel',
    hidden: true,
    scrollIntoView(options) {
      scrollCalls.push(options);
    }
  };

  const dispose = bindAdvancedToggle({ button, panel, icon: button.icon });

  assert.equal(button.getAttribute('aria-controls'), 'advanced-panel');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.icon.textContent, '▾');

  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.icon.textContent, '▴');
  assert.deepEqual(scrollCalls, []);

  button.click();
  assert.equal(panel.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.icon.textContent, '▾');
  assert.equal(scrollCalls.length, 0);

  dispose();
  button.click();
  assert.equal(panel.hidden, true);
});

test('Advanced binding rejects a missing required icon instead of hiding drift', () => {
  const button = new FakeButton();
  const panel = { id: 'advanced-panel', hidden: true };

  assert.throws(
    () => bindAdvancedToggle({ button, panel, icon: null }),
    /Advanced toggle icon is required/
  );
});

test('declining clear-local-inventory confirmation leaves inventory untouched', async () => {
  const calls = { prompts: [], store: 0 };
  const result = await clearLocalInventory({
    confirmImpl(message) {
      calls.prompts.push(message);
      return false;
    },
    store: {
      async clearAll() {
        calls.store += 1;
      }
    }
  });

  assert.equal(result.cleared, false);
  assert.deepEqual(calls, {
    prompts: [CLEAR_LOCAL_INVENTORY_CONFIRMATION],
    store: 0
  });
  assert.match(CLEAR_LOCAL_INVENTORY_CONFIRMATION, /preserves Manager settings and deletion-job state/i);
  assert.match(CLEAR_LOCAL_INVENTORY_CONFIRMATION, /does not delete any ChatGPT conversations/i);
});

test('confirmed clear-local-inventory action clears only the conversation store', async () => {
  let cleared = 0;
  const result = await clearLocalInventory({
    confirmImpl: () => true,
    store: {
      async clearAll() {
        cleared += 1;
      }
    }
  });

  assert.equal(result.cleared, true);
  assert.equal(cleared, 1);
});
