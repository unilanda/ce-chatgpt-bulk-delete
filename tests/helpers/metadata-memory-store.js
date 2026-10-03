'use strict';
// Deterministic repository unit-test adapter. Native IndexedDB has a separate browser gate; this adapter is synthetic.
const {SCHEMA}=require('../../manager-meta-db.js');
class MetadataMemoryStore{
 constructor(){this.stores=new Map(Object.keys(SCHEMA).map(n=>[n,new Map()]));this.tail=Promise.resolve();}
 async atomic(names,mode,work){const run=async()=>{const copies=new Map(names.map(n=>[n,new Map([...this.stores.get(n)].map(([k,v])=>[k,structuredClone(v)]))]));const data=n=>{if(!copies.has(n))throw new Error('Store out of transaction');return copies.get(n);};const io={
 get:async(n,k)=>structuredClone(data(n).get(k)),
 all:async(n,index,key)=>[...data(n).values()].filter(v=>!index||v[SCHEMA[n].indexes[index][0]]===key).map(v=>structuredClone(v)),
 put:async(n,v)=>{const k=v[SCHEMA[n].key];for(const [index,[field,unique]]of Object.entries(SCHEMA[n].indexes)){if(unique&&v[field]!=null&&[...data(n)].some(([other,row])=>other!==k&&row[field]===v[field]))throw new Error(`ConstraintError ${index}`);}data(n).set(k,structuredClone(v));return k;},
 add:async(n,v)=>{if(data(n).has(v[SCHEMA[n].key]))throw new Error('ConstraintError');return io.put(n,v);},
 delete:async(n,k)=>data(n).delete(k),clear:async n=>data(n).clear()
 };const result=await work(io);if(mode==='readwrite')for(const[n,m]of copies)this.stores.set(n,m);return structuredClone(result);};const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;}
 get(n,k){return this.atomic([n],'readonly',io=>io.get(n,k));}getAll(n,i,k){return this.atomic([n],'readonly',io=>io.all(n,i,k));}
 put(n,v){return this.atomic([n],'readwrite',io=>io.put(n,v));}delete(n,k){return this.atomic([n],'readwrite',io=>io.delete(n,k));}clear(n){return this.atomic([n],'readwrite',io=>io.clear(n));}
}
module.exports={MetadataMemoryStore};
