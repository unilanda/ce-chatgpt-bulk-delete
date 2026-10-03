'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ref = require('../conversation-ref.js');
const Providers = require('../provider-capabilities.js');

test('canonical refs reject aliases, malformed escapes and ambiguous provider IDs', () => {
  assert.throws(() => Ref.decode('ChatGPT:x'));
  assert.throws(() => Ref.decode('chatgpt:%78'));
  assert.throws(() => Ref.decode('chatgpt:x:y'));
  assert.throws(() => Ref.decode('chatgpt:%'));
  const ref = Ref.encode('claude', 'a:b/% ü');
  assert.equal(Ref.encode(Ref.decode(ref)), ref);
  assert.notEqual(Ref.encode('claude','x'), Ref.encode('chatgpt','x'));
});
test('Claude descriptor exists but no provider operation is falsely available', () => {
  assert.equal(Providers.get('claude').status, 'contract-only');
  assert.equal(Providers.get('claude').capture.available, false);
  assert.equal(Providers.get('chatgpt').capture.available, false);
});
test('action surface distinguishes unimplemented engines from missing prerequisites', () => {
  const A = require('../manager-actions.js');
  const context = { refs:['chatgpt:x'], metadataReady:true, records:[{id:'x'}] };
  assert.equal(A.evaluate('collection.add', context).enabled, true);
  assert.equal(A.evaluate('tag.add', context).enabled, true);
  for (const id of ['archive.save','analyze.similar','analyze.cluster','summarize',
    'merge.raw','merge.structured','merge.canonical','synthesize','project.move']) {
    const result = A.evaluate(id, context);
    assert.equal(result.enabled, false, id);
    assert.ok(result.reason.length > 8, id);
  }
  assert.equal(A.evaluate('delete', {...context,activeDeleteJob:true}).enabled,false);
  assert.equal(A.evaluate('delete', {...context,refs:['claude:x']}).enabled,false);
});
test('future action runner refuses missing implementations even with archived metadata', async () => {
  const A = require('../manager-actions.js');
  let calls=0;
  const runner=A.createRunner({handlers:{},onProgress:()=>calls++});
  await assert.rejects(runner.run('summarize',{refs:['chatgpt:x'],metadataReady:true}),
    /not implemented|not connected/i);
  assert.equal(calls,0);
});
test('freshness separates failure, payload completeness and unknown timestamps', () => {
  const F = require('../archive-freshness.js');
  assert.equal(F.evaluate(null,null).state,'never_saved');
  const snapshot={revision:1,source_updated_at_ms:10000,source_version:null,
    completeness:'complete',payload_ref:{store:'test',key:'payload'},payload_state:'committed'};
  const record={capture_state:'captured',snapshot,last_attempt:{state:'failed'}};
  assert.equal(F.evaluate(record,{updated_at_ms:10000}).state,'current');
  assert.equal(F.evaluate(record,{updated_at_ms:11000}).state,'stale');
  assert.equal(F.evaluate(record,{}).state,'unknown');
  assert.equal(F.evaluate({...record,snapshot:{...snapshot,completeness:'partial'}},
    {updated_at_ms:10000}).state,'unknown');
  assert.equal(F.evaluate({capture_status:'current',source_updated_at:10},
    {updated_at_ms:10000}).state,'unknown');
});
test('capture orchestrator is inert without a connected engine', async () => {
  const C = require('../capture-orchestrator.js');
  let tabs=0;
  const runner=C.createOrchestrator({providers:{},tabRunner:{acquire:async()=>tabs++}});
  await assert.rejects(runner.run({refs:['chatgpt:x'],mode:'managed_tab'}),/capture.*not connected/i);
  assert.equal(tabs,0);
});
