'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDashboardHarness,conversationRecord}=require('./helpers/dashboard-harness.js');
async function start(){const h=await createDashboardHarness({records:[conversationRecord('one'),conversationRecord('project','project-protected'),conversationRecord('custom','custom-gpt-protected')],confirmImpl:()=>true});await h.awaitInitialization();return h;}
test('full action surface exists with disabled future actions and reasons',async()=>{const h=await start();await h.selectAllRows();for(const id of ['save-update-btn','analyze-selected-btn','summarize-selected-btn','merge-selected-btn','move-selected-btn']){const b=h.document.getElementById(id);assert.ok(b,id);assert.equal(b.disabled,true,id);assert.ok(b.title.length>10,id);}assert.equal(h.document.getElementById('tag-selected-btn').disabled,false);assert.deepEqual(h.consoleCalls.error,[]);});
test('Tags create/add/remove/rename are local and preserve generic selection',async()=>{const h=await start();await h.selectAllRows();await h.document.getElementById('tag-selected-btn').click();h.document.getElementById('tag-modal-name').value='Research';await h.document.getElementById('tag-modal-confirm-btn').click();const db=h.managerMetaDatabase;const tag=[...db.stores.get('tags').records.values()][0];assert.ok(tag);assert.equal(db.stores.get('tag_memberships').records.size,3);assert.match(h.document.getElementById('selected-count-text').textContent,/3/);h.document.getElementById('tag-filter').value=tag.id;await h.document.getElementById('tag-filter').dispatch('change');await h.document.getElementById('remove-tag-btn').click();assert.equal(db.stores.get('tag_memberships').records.size,0);assert.match(h.document.getElementById('selected-count-text').textContent,/3/);});
test('Projects and Archived views use actual metadata, not artificial future results',async()=>{const h=await start();const v=h.document.getElementById('manager-view-filter');v.value='projects';await v.dispatch('change');assert.equal(h.document.querySelectorAll('.row-checkbox').length,1);v.value='archived';await v.dispatch('change');assert.equal(h.document.querySelectorAll('.row-checkbox').length,0);assert.match(h.document.getElementById('manager-view-help').textContent,/capture|archive/i);});

test('metadata database failure does not disable the existing inventory or Delete wizard', async () => {
  const h=await createDashboardHarness({records:[conversationRecord('one')],failMetadataOpen:true});
  await h.awaitInitialization();
  assert.match(h.document.getElementById('manager-metadata-status').textContent,/unavailable/);
  assert.equal(h.document.getElementById('inventory-count').textContent,'1 conversation');
  await h.selectAllRows();
  assert.equal(h.document.getElementById('delete-selected-btn').disabled,false);
  assert.equal(h.document.getElementById('tag-selected-btn').disabled,true);
  await h.document.getElementById('delete-selected-btn').click();
  assert.equal(h.document.getElementById('progress-modal').classList.contains('hidden'),false);
  assert.equal(h.fetchCalls.filter(call => call.options?.method==='PATCH').length,0);
});
