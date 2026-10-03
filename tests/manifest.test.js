'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')
);
const dashboardHtml = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard.html'),
  'utf8'
);
const background = fs.readFileSync(
  path.join(__dirname, '..', 'background.js'),
  'utf8'
);

test('manifest presents ChatGPT Manager without broadening permissions', () => {
  assert.equal(manifest.name, 'ChatGPT Manager');
  assert.match(manifest.description, /manage, find, and act/i);
  assert.equal(manifest.action.default_title, 'Open ChatGPT Manager');
  assert.deepEqual(manifest.permissions, ['storage', 'alarms']);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
});

test('dashboard and service worker load the same tracked runtime identity', () => {
  const dashboardScripts = Array.from(
    dashboardHtml.matchAll(/<script\s+src=["']([^"']+)["']/g),
    match => match[1]
  );
  assert.equal(dashboardScripts[0], 'runtime-identity.js');
  assert.match(background, /importScripts\(\s*['"]runtime-identity\.js['"]/);
});
