'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const makeTabs=()=>{let id=0;const tabs=new Map(),removed=[];return {tabs,removed,adapter:{tabs:{async create(o){const row={id:++id,windowId:1,active:!!o.active,...o};tabs.set(row.id,row);return row;},async get(n){if(!tabs.has(n))throw new Error('Tab missing');return tabs.get(n);},async update(n,o){Object.assign(tabs.get(n),o);return tabs.get(n);},async remove(n){removed.push(n);tabs.delete(n);}}}};};
test('tab leases close only owned matching tabs; current tabs and navigated tabs remain',async()=>{const {createTabRunner}=require('../capture-tab-runner.js');const t=makeTabs(),r=createTabRunner({browser:t.adapter});const provider={conversationURL:ref=>`https://chatgpt.com/c/${ref.split(':')[1]}`,matchesConversationURL:(url,ref)=>url===`https://chatgpt.com/c/${ref.split(':')[1]}`};const lease=await r.acquire({mode:'managed_tab',ref:'chatgpt:x',provider});await r.release(lease);assert.deepEqual(t.removed,[1]);const user=await t.adapter.tabs.create({url:'https://chatgpt.com/c/y'});const existing=await r.acquire({mode:'current_tab',tabId:user.id,ref:'chatgpt:y',provider});await r.release(existing);assert.ok(t.tabs.has(user.id));const other=await r.acquire({mode:'managed_tab',ref:'chatgpt:z',provider});t.tabs.get(other.tabId).url='https://example.invalid/';assert.equal((await r.release(other)).closed,false);assert.ok(t.tabs.has(other.tabId));});
test('capture lifecycle is sequential, waits for complete readiness, commits payload before metadata, then closes',async()=>{const {createOrchestrator}=require('../capture-orchestrator.js');const events=[];const runner=createOrchestrator({providers:{chatgpt:{capture:{version:'fixture',async waitReady({ref}){events.push(`ready:${ref}`);},async capture({ref}){events.push(`capture:${ref}`);return {conversation_ref:ref,completeness:'complete',fixture:true};}}}},tabRunner:{async acquire({ref}){events.push(`open:${ref}`);return {ref,tabId:1};},async assertCurrent(){},async release(l){events.push(`close:${l.ref}`);return {closed:true};}},payloadStore:{async persist(result){events.push(`payload:${result.conversation_ref}`);return {durable:true,payload_ref:{store:'fixtures',key:'p'}};}},archiveRegistry:{async recordCapture(input){events.push(`metadata:${input.conversation_ref}`);return {revision:1};}},idFactory:()=> 'fixture-capture'});const result=await runner.run({refs:['chatgpt:a','chatgpt:b'],mode:'managed_tab'});assert.equal(result.state,'complete');assert.deepEqual(events,['open:chatgpt:a','ready:chatgpt:a','capture:chatgpt:a','payload:chatgpt:a','metadata:chatgpt:a','close:chatgpt:a','open:chatgpt:b','ready:chatgpt:b','capture:chatgpt:b','payload:chatgpt:b','metadata:chatgpt:b','close:chatgpt:b']);});
test('cancel during readiness closes owned lease and never captures or commits',async()=>{const {createOrchestrator}=require('../capture-orchestrator.js');const ac=new AbortController();let capture=0,closed=0;const r=createOrchestrator({providers:{chatgpt:{capture:{async waitReady(){ac.abort();},async capture(){capture++;}}}},tabRunner:{async acquire(){return {tabId:1};},async assertCurrent(){},async release(){closed++;return {closed:true};}},payloadStore:{persist(){throw new Error('must not persist');}},archiveRegistry:{recordCapture(){throw new Error('must not commit');}}});const result=await r.run({refs:['chatgpt:x','chatgpt:y'],mode:'managed_tab',signal:ac.signal});assert.equal(result.state,'cancelled');assert.equal(capture,0);assert.equal(closed,1);});
test('partial or wrong-conversation capture cannot create an archive head',async()=>{const {createOrchestrator}=require('../capture-orchestrator.js');for(const content of [{conversation_ref:'chatgpt:x',completeness:'partial'},{conversation_ref:'chatgpt:other',completeness:'complete'}]){let saved=0;const r=createOrchestrator({providers:{chatgpt:{capture:{async waitReady(){},async capture(){return content;}}}},tabRunner:{async acquire(){return {};},async assertCurrent(){},async release(){return {closed:true};}},payloadStore:{async persist(){saved++;return {durable:true};}},archiveRegistry:{async recordCapture(){saved++;}}});const result=await r.run({refs:['chatgpt:x'],mode:'managed_tab'});assert.equal(result.state,'failed');assert.equal(saved,0);}});

test('failed foreground activation cleans up the owned tab without touching current tab', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  t.adapter.tabs.update = async () => { throw new Error('Focus failed'); };
  const provider = { conversationURL: () => 'https://chatgpt.com/c/x', matchesConversationURL: url => url === 'https://chatgpt.com/c/x' };
  const runner = createTabRunner({ browser: t.adapter });
  await assert.rejects(runner.acquire({ mode: 'managed_tab', ref: 'chatgpt:x', provider, allowFocus: true }), /Focus failed/);
  assert.deepEqual(t.removed, [1]);
});

test('capture that requires foreground rejects missing focus consent before opening a tab', async () => {
  const { createOrchestrator } = require('../capture-orchestrator.js');
  let opened = 0;
  const runner = createOrchestrator({
    providers: { chatgpt: { capture: { requiresFocus: true, async waitReady() {}, async capture() {} } } },
    tabRunner: { async acquire() { opened++; return {}; }, async assertCurrent() {}, async release() {} },
    payloadStore: { persist() {} }, archiveRegistry: { recordCapture() {} }
  });
  await assert.rejects(runner.run({ refs: ['chatgpt:x'], allowFocus: false }), /focus permission/i);
  assert.equal(opened, 0);
});

test('checkpoint failure after committed archive reports exactly one preserved successful item', async () => {
  const { createOrchestrator } = require('../capture-orchestrator.js');
  const runner = createOrchestrator({
    providers: { chatgpt: { capture: { async waitReady() {}, async capture({ ref }) { return { conversation_ref: ref, completeness: 'complete' }; } } } },
    tabRunner: { async acquire() { return {}; }, async assertCurrent() {}, async release() { return { closed: true }; } },
    payloadStore: { async persist() { return { durable: true, payload_ref: { store: 'fixture', key: 'p' } }; } },
    archiveRegistry: { async recordCapture() { return { revision: 1 }; } },
    onCheckpoint: async event => { if (event.phase === 'committed') throw new Error('Checkpoint unavailable'); }
  });
  const result = await runner.run({ refs: ['chatgpt:x'] });
  assert.equal(result.state, 'failed');
  assert.equal(result.completed, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].state, 'captured_checkpoint_failed');
  assert.equal(result.items[0].revision, 1);
});

test('a provider capture ignoring abort cannot later commit after a readiness timeout', async () => {
  const { createOrchestrator } = require('../capture-orchestrator.js');
  let closed = 0, committed = 0;
  const runner = createOrchestrator({
    providers: { chatgpt: { capture: { async waitReady() { await new Promise(r => setTimeout(r, 30)); }, async capture() { throw new Error('Must not capture'); } } } },
    tabRunner: { async acquire() { return {}; }, async assertCurrent() {}, async release() { closed++; } },
    payloadStore: { async persist() { committed++; } }, archiveRegistry: { recordCapture() {} }, stageTimeoutMs: 5
  });
  const result = await runner.run({ refs: ['chatgpt:x'] });
  await new Promise(r => setTimeout(r, 35));
  assert.equal(result.state, 'failed'); assert.equal(result.items[0].error_code, 'timeout');
  assert.equal(closed, 1); assert.equal(committed, 0);
});

test('managed tab can be acquired before navigation completes but must match when capture starts', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  t.adapter.tabs.create = async ({ url, active }) => { const tab = { id: 1, windowId: 1, url: '', pendingUrl: url, active }; t.tabs.set(1, tab); return tab; };
  const provider = { conversationURL: () => 'https://chatgpt.com/c/x', matchesConversationURL: url => url === 'https://chatgpt.com/c/x' };
  const runner = createTabRunner({ browser: t.adapter });
  const lease = await runner.acquire({ mode: 'managed_tab', ref: 'chatgpt:x', provider });
  await assert.rejects(runner.assertCurrent(lease), error => error?.code === 'tab_not_ready');
  t.tabs.get(1).url = t.tabs.get(1).pendingUrl;
  await runner.assertCurrent(lease);
  await runner.release(lease);
  assert.deepEqual(t.removed, [1]);
});

test('capture identity rejects a pending navigation away even while current URL still matches', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  const provider = {
    conversationURL: () => 'https://chatgpt.com/c/x',
    matchesConversationURL: (url, ref) => url === `https://chatgpt.com/c/${ref.split(':')[1]}`
  };
  const runner = createTabRunner({ browser: t.adapter });
  const lease = await runner.acquire({ mode: 'managed_tab', ref: 'chatgpt:x', provider });
  const tab = t.tabs.get(lease.tabId);
  assert.equal(tab.url, 'https://chatgpt.com/c/x');
  tab.pendingUrl = 'https://example.invalid/';

  await assert.rejects(runner.assertCurrent(lease), /navigated away/);
  assert.deepEqual(await runner.release(lease), { closed: false, reason: 'user_navigated' });
  assert.deepEqual(t.removed, []);
});

test('current-tab capture rejects pending navigation away without closing the user tab', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  const provider = {
    conversationURL: () => 'https://chatgpt.com/c/x',
    matchesConversationURL: (url, ref) => url === `https://chatgpt.com/c/${ref.split(':')[1]}`
  };
  const userTab = await t.adapter.tabs.create({ url: 'https://chatgpt.com/c/x' });
  const runner = createTabRunner({ browser: t.adapter });
  const lease = await runner.acquire({ mode: 'current_tab', tabId: userTab.id, ref: 'chatgpt:x', provider });
  t.tabs.get(userTab.id).pendingUrl = 'https://example.invalid/';

  await assert.rejects(runner.assertCurrent(lease), /navigated away/);
  assert.deepEqual(await runner.release(lease), { closed: false, reason: 'current_tab' });
  assert.ok(t.tabs.has(userTab.id));
});

test('cleanup closes an owned tab that is still loading the expected conversation', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  t.adapter.tabs.create = async ({ url, active }) => {
    const tab = { id: 1, windowId: 1, url: '', pendingUrl: url, active };
    t.tabs.set(1, tab);
    return tab;
  };
  const provider = {
    conversationURL: () => 'https://chatgpt.com/c/x',
    matchesConversationURL: (url, ref) => url === `https://chatgpt.com/c/${ref.split(':')[1]}`
  };
  const runner = createTabRunner({ browser: t.adapter });
  const lease = await runner.acquire({ mode: 'managed_tab', ref: 'chatgpt:x', provider });

  assert.deepEqual(await runner.release(lease), { closed: true });
  assert.deepEqual(t.removed, [1]);
});

test('cleanup retains an owned tab once navigation away from the conversation is pending', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  const provider = {
    conversationURL: () => 'https://chatgpt.com/c/x',
    matchesConversationURL: (url, ref) => url === `https://chatgpt.com/c/${ref.split(':')[1]}`
  };
  const runner = createTabRunner({ browser: t.adapter });
  const lease = await runner.acquire({ mode: 'managed_tab', ref: 'chatgpt:x', provider });
  t.tabs.get(lease.tabId).pendingUrl = 'https://example.invalid/';

  assert.deepEqual(await runner.release(lease), { closed: false, reason: 'user_navigated' });
  assert.deepEqual(t.removed, []);
});

test('foreground capture detects an active tab in an unfocused window', async () => {
  const { createTabRunner } = require('../capture-tab-runner.js');
  const t = makeTabs();
  t.adapter.windows = { get: async () => ({ focused: false }) };
  const provider = { conversationURL: () => 'https://chatgpt.com/c/x', matchesConversationURL: url => url === 'https://chatgpt.com/c/x' };
  const runner = createTabRunner({ browser: t.adapter });
  const lease = await runner.acquire({ mode: 'managed_tab', ref: 'chatgpt:x', provider, allowFocus: true });
  await assert.rejects(runner.assertCurrent(lease, { requiresFocus: true }), /focus/);
  await runner.release(lease);
});
