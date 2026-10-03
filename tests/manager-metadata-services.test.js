'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MetadataMemoryStore}=require('./helpers/metadata-memory-store.js');
const Collections=require('../collection-service.js'),Tags=require('../tag-service.js');
const H='a'.repeat(64),H2='b'.repeat(64);
const capture=(overrides={})=>({conversation_ref:'chatgpt:x',capture_id:'capture-1',source_updated_at:10,content_hash:H,normalized_hash:H,message_count:2,formats:['md'],payload_ref:{store:'test_payloads',key:'p1'},completeness:'complete',scope:'selected_branch',branch_key:'branch1',capture_version:'fixture-v1',normalizer_version:'norm-v1',...overrides});
function setup(){const store=new MetadataMemoryStore();let n=0;return {store,options:{store,now:()=>100000,idFactory:()=>`id-${++n}`}};}
test('Collections and Tags remain independent and preserve selection refs of all providers',async()=>{const {store,options}=setup();const c=Collections.createService(options),t=Tags.createService(options);const col=await c.createCollection('RNA',{refs:['chatgpt:x','claude:x']});const tag=await t.createTag('RNA',{refs:['chatgpt:x']});await c.renameCollection(col.id,'Switches',{expectedRevision:1});await assert.rejects(c.renameCollection(col.id,'Wrong',{expectedRevision:1}),/changed/);await c.deleteCollection(col.id);assert.equal((await t.listTags()).length,1);assert.deepEqual(await t.listConversationRefs(tag.id),['chatgpt:x']);assert.equal((await store.getAll('collection_memberships')).length,0);});
test('duplicate membership preserves original added_at and rename conflicts leave store intact',async()=>{const {options}=setup();const c=Collections.createService(options);const a=await c.createCollection('A',{refs:['chatgpt:x']}),b=await c.createCollection('B');await c.addConversationRefs(a.id,['chatgpt:x']);assert.equal((await c.snapshot()).memberships.length,1);await assert.rejects(c.renameCollection(b.id,'A'),/already exists/);assert.deepEqual((await c.listCollections()).map(x=>x.name),['A','B']);await assert.rejects(c.addConversationRefs('missing',['chatgpt:x']),/not found/);});
test('archive captures require a committed payload, preserve revisions, idempotence and old success on failure',async()=>{const {store}=setup();const R=require('../archive-registry.js').createRegistry({store,now:()=>100000});await assert.rejects(R.recordCapture(capture({payload_ref:null})),/payload/);const first=await R.recordCapture(capture());assert.equal(first.revision,1);assert.equal((await R.recordCapture(capture())).revision,1);await R.markFailed('chatgpt:x','capture_failed');assert.equal((await R.get('chatgpt:x')).snapshot.revision,1);assert.equal((await R.get('chatgpt:x')).last_attempt.state,'failed');await R.recordCapture(capture({capture_id:'capture-2',source_updated_at:11,content_hash:H2,normalized_hash:H2}));assert.equal((await R.getRevision('chatgpt:x',1)).normalized_hash,`sha256:${H}`);assert.equal((await R.get('chatgpt:x')).revision,2);await assert.rejects(R.recordCapture(capture({capture_id:'capture-3',expected_revision:1})),/changed/);});
test('archive stale marking never overwrites the timestamp of the captured snapshot',async()=>{const {store}=setup();const R=require('../archive-registry.js').createRegistry({store});await R.recordCapture(capture());await R.markStale('chatgpt:x',11);const row=await R.get('chatgpt:x');assert.equal(row.snapshot.source_updated_at_ms,10000);assert.equal(await R.evaluateFreshness('chatgpt:x',11),'stale');assert.equal(await R.evaluateFreshness('chatgpt:x',null),'stale');});
test('artifact commit atomically pins source revision hashes and derives staleness without erasing provenance',async()=>{const {store,options}=setup();const R=require('../archive-registry.js').createRegistry({store});await R.recordCapture(capture());const A=require('../artifact-service.js').createService(options);const artifact=await A.create({type:'summary',title:'Fixture summary',producer:{id:'test-engine',version:'1'},config_hash:H,sources:[{conversation_ref:'chatgpt:x',revision:1}]});await assert.rejects(A.commit(artifact.id,{payload_ref:null}),/payload/);await A.commit(artifact.id,{payload_ref:{store:'test_payloads',key:'summary1'}});assert.equal((await A.freshness(artifact.id)).state,'current');await R.recordCapture(capture({capture_id:'capture-2',content_hash:H2,normalized_hash:H2}));assert.equal((await A.freshness(artifact.id)).state,'stale');assert.equal((await A.sources(artifact.id))[0].revision,1);await assert.rejects(A.commit(artifact.id,{payload_ref:{store:'test_payloads',key:'overwrite'}}),/immutable/);});
test('artifacts reject nonexistent sources and partial captures; no fake ready artifact is stored',async()=>{const {store,options}=setup();const A=require('../artifact-service.js').createService(options);await assert.rejects(A.create({type:'summary',title:'Bad',producer:{id:'test',version:'1'},config_hash:H,sources:[{conversation_ref:'chatgpt:missing',revision:1}]}),/source/);assert.equal((await A.list()).length,0);const R=require('../archive-registry.js').createRegistry({store});await R.recordCapture(capture({completeness:'partial'}));await assert.rejects(A.create({type:'summary',title:'Bad',producer:{id:'test',version:'1'},config_hash:H,sources:[{conversation_ref:'chatgpt:x',revision:1}]}),/complete/);});
test('relationship direction and confidence are validated; symmetric relations deduplicate',async()=>{const {options}=setup();const A=require('../analysis-repository.js').createRepository(options);const r={type:'similar_to',source_ref:'chatgpt:x',target_ref:'claude:x',asserted_by:'user',confidence:0.8};const a=await A.putRelationship(r),b=await A.putRelationship({...r,source_ref:r.target_ref,target_ref:r.source_ref});assert.equal(a.key,b.key);assert.equal((await A.listRelationships()).length,1);await A.putRelationship({...r,type:'supersedes'});await A.putRelationship({...r,type:'supersedes',source_ref:r.target_ref,target_ref:r.source_ref});assert.equal((await A.listRelationships()).length,3);await assert.rejects(A.putRelationship({...r,confidence:2}),/confidence/);await assert.rejects(A.putRelationship({...r,asserted_by:'model'}),/artifact/);});

test('missing or corrupted artifact provenance cannot be reported current', async () => {
  const { store, options } = setup();
  const R = require('../archive-registry.js').createRegistry({ store });
  await R.recordCapture(capture());
  const A = require('../artifact-service.js').createService(options);
  const item = await A.create({ type: 'summary', title: 'Test', producer: { id: 'test', version: '1' }, config_hash: H, sources: [{ conversation_ref: 'chatgpt:x', revision: 1 }] });
  await A.commit(item.id, { payload_ref: { store: 'fixture', key: 'p' } });
  await store.clear('artifact_sources');
  assert.equal((await A.freshness(item.id)).state, 'unknown');
});

test('ChatGPT URL matching only accepts canonical conversation paths', () => {
  const P = require('../provider-adapters.js');
  assert.equal(P.matchesChatGPTURL('https://chatgpt.com/c/x', 'chatgpt:x'), true);
  assert.equal(P.matchesChatGPTURL('https://chatgpt.com/not-a-chat/c/x', 'chatgpt:x'), false);
  assert.equal(P.matchesChatGPTURL('https://chatgpt.com/c/x/other', 'chatgpt:x'), false);
  assert.equal(P.matchesChatGPTURL('https://example.invalid/c/x', 'chatgpt:x'), false);
});

test('a normalized hash must be supplied, not invented from an unrelated raw payload hash', async()=>{
  const {store}=setup();const R=require('../archive-registry.js').createRegistry({store});
  await assert.rejects(R.recordCapture(capture({normalized_hash:undefined})),/hash/);
});

test('corruption of a pinned immutable source makes artifact freshness unknown', async()=>{
  const {store,options}=setup();const R=require('../archive-registry.js').createRegistry({store});
  await R.recordCapture(capture());const A=require('../artifact-service.js').createService(options);
  const a=await A.create({type:'summary',title:'Fixture',producer:{id:'test',version:'1'},config_hash:H,sources:[{conversation_ref:'chatgpt:x',revision:1}]});
  await A.commit(a.id,{payload_ref:{store:'fixture',key:'out'}});
  const source=await R.getRevision('chatgpt:x',1);
  await store.put('archive_revisions',{...source,normalized_hash:'sha256:'+H2});
  assert.equal((await A.freshness(a.id)).state,'unknown');
});
