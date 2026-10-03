'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');

test('service worker owns durable deletion modules and session acquisition', () => {
  for (const moduleName of [
    'job-store.js',
    'db.js',
    'delete-job-executor.js',
    'job-controller.js',
    'background-runtime.js'
  ]) {
    assert.match(background, new RegExp(`['"]${moduleName.replace('.', '\\.')}['"]`));
  }
  assert.match(background, /https:\/\/chatgpt\.com\/api\/auth\/session/);
  assert.match(background, /credentials:\s*['"]include['"]/);
  assert.match(background, /acquireSessionToken/);
});

test('dashboard is a job client and contains no conversation deletion transport', () => {
  assert.match(dashboard, /JobClient\.createJobClient/);
  assert.doesNotMatch(dashboard, /backend-api\/conversation\/|runDeletionQueue/);
  assert.doesNotMatch(dashboard, /chrome\.alarms/);
});

test('background wiring does not write authentication material to storage', () => {
  assert.doesNotMatch(background, /storage\.(?:local\.)?set\([^)]*(?:token|authorization|cookie)/i);
  assert.doesNotMatch(background, /sendMessage\([^)]*(?:accessToken|authorization|cookie)/i);
});
