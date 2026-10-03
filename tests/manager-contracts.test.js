'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hash = 'sha256:' + 'a'.repeat(64);

test('prerequisites distinguish missing, stale, and complete-but-freshness-unknown archives', () => {
  const P = require('../manager-prerequisites.js');
  const snapshot = { completeness:'complete', payload_state:'committed', payload_ref:{store:'fixture',key:'p'}, source_updated_at_ms:10 };
  const context = { refs:['chatgpt:missing','chatgpt:stale','claude:unknown'], archives:{ 'chatgpt:stale':{snapshot},'claude:unknown':{snapshot} }, observations:{'chatgpt:stale':{updated_at_ms:11}} };
  const current = P.inspect(['current_archives'], context)[0];
  assert.equal(current.satisfied, false);
  assert.deepEqual(current.missing_refs, ['chatgpt:missing']);
  assert.deepEqual(current.stale_refs, ['chatgpt:stale']);
  assert.deepEqual(current.unknown_refs, ['claude:unknown']);
  const complete = P.inspect(['complete_archives'], { ...context, refs:['chatgpt:stale','claude:unknown'] })[0];
  assert.equal(complete.satisfied, true);
});

test('generic runner explicitly sequences prerequisite acquisition and preserves selection snapshot', async () => {
  const A = require('../manager-actions.js');
  const events = [], selected = ['chatgpt:x'];
  const runner = A.createRunner({ handlers:{ 'collection.add':{
    prepare: async plan => { events.push('prepare'); selected.push('chatgpt:y'); return plan; },
    acquirePrerequisites: async plan => { events.push('acquire'); return plan; },
    review: async plan => { events.push('review'); assert.deepEqual(plan.conversation_refs,['chatgpt:x']); return true; },
    execute: async plan => { events.push('execute'); return plan.conversation_refs; }
  } } });
  const result = await runner.run('collection.add', { refs:selected, metadataReady:true });
  assert.deepEqual(events,['prepare','acquire','review','execute']);
  assert.equal(result.state,'complete');
});

test('analysis request pins revisions, modes and hashes without creating a result', () => {
  const A = require('../analysis-contracts.js');
  const source = { conversation_ref:'claude:x', revision:1,content_hash:hash,normalized_hash:hash,normalizer_version:'norm1',scope:'selected_branch',branch_key:'main' };
  const request = A.request({ operation:'merge.structured',mode:'deduplicated_with_provenance',sources:[source],instruction_hash:hash });
  assert.equal(request.losslessness,'not-guaranteed');
  assert.equal(request.remote_submission_requires_user_consent,true);
  assert.throws(() => A.execute(request), /not connected/);
  assert.throws(() => A.request({...request,mode:'unrecognized'}), /mode/);
  assert.equal(A.request({ operation:'merge.raw',mode:'source_preserving',sources:[source],instruction_hash:hash }).output_type, 'raw_merge');
});

test('future job envelope has monotonic progress and does not redefine DeleteJob', () => {
  const J = require('../manager-job-contracts.js');
  let job = J.create({id:'sample',type:'capture',refs:['chatgpt:x','claude:x'],now:1});
  assert.throws(() => J.create({id:'sample',type:'delete',refs:['chatgpt:x']}), /kind/);
  job=J.transition(job,'running',{now:2});
  job=J.transition(job,'paused',{now:3,completed:1});
  assert.throws(() => J.transition(job,'running',{completed:0}), /progress/);
  job=J.transition(job,'running',{now:4,completed:1});
  assert.throws(() => J.transition(job,'completed',{completed:1}), /not complete/);
  assert.equal(J.transition(job,'completed',{now:5,completed:2}).state,'completed');
});

test('Chrome facade is inert at construction; unavailable exports do not request permissions', async () => {
  const B = require('../browser-runtime-adapter.js');
  let calls=0; const adapter=B.createChromeAdapter({runtime:{getManifest:()=>({permissions:['storage','alarms']})},downloads:{download:()=>calls++}});
  assert.equal(calls,0); assert.equal(adapter.downloads.available,false);
  await assert.rejects(adapter.downloads.download({url:'https://example.invalid'}),/permission/);
  assert.equal(calls,0); assert.equal(B.firefoxContract.status,'contract-only');
});
