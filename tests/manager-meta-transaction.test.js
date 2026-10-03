'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ManagerMetaDB}=require('../manager-meta-db.js');

function driver() {
  const requests=[];
  const tx={objectStore:()=>({put:()=>{const r={};requests.push(r);return r;}}),abort(){this.onabort();}};
  const db=new ManagerMetaDB({indexedDBImpl:null,channelFactory:()=>null});
  db.db={transaction:()=>tx};
  return {db,tx,requests};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('metadata request success alone is not a successful repository transaction',async()=>{
  const {db,tx,requests}=driver();let settled=false,notifications=0;db.subscribe(()=>notifications++);
  const operation=db.atomic(['tags'],'readwrite',io=>io.put('tags',{id:'t',name:'Tag'}));
  operation.then(()=>settled=true);
  requests[0].onsuccess({target:{result:'t'}});await tick();
  assert.equal(settled,false);assert.equal(notifications,0);
  tx.oncomplete();assert.equal(await operation,'t');assert.equal(notifications,1);
});

test('an abort after an earlier successful request rejects and never broadcasts commit',async()=>{
  const {db,tx,requests}=driver();let notified=0;db.subscribe(()=>notified++);
  const operation=db.atomic(['tags'],'readwrite',io=>io.put('tags',{id:'t',name:'Tag'}));
  requests[0].onsuccess({target:{result:'t'}});await tick();
  tx.error=new Error('Quota abort');tx.onabort();
  await assert.rejects(operation,/Quota abort/);assert.equal(notified,0);
});

test('a callback failure aborts the metadata transaction and preserves the original error',async()=>{
  const {db,tx}=driver();let aborted=false;
  tx.abort=function(){aborted=true;this.onabort();};
  await assert.rejects(db.atomic(['tags'],'readwrite',()=>{throw new Error('Invalid metadata');}),/Invalid metadata/);
  assert.equal(aborted,true);
});

test('external asynchronous work cannot be reported as a committed metadata write',async()=>{
  const {db,tx}=driver();let finish;
  const operation=db.atomic(['tags'],'readwrite',()=>new Promise(resolve=>{finish=resolve;}));
  tx.oncomplete();await assert.rejects(operation,/outlived/);finish('too late');
});
