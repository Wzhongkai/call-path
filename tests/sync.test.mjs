import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WorkspaceSync} from '../dist/sync.js';
import {validateWorkspace} from '../dist/workspace.js';
test('API paths follow the application directory at root or beneath /code/',()=>{
  assert.equal(new URL('./api','https://example.test/code/account.js').pathname,'/code/api');
  assert.equal(new URL('./api','https://example.test/account.js').pathname,'/api');
});
function setup(send,extra={}){const saved=new Map(),states=[];const sync=new WorkspaceSync({send,revision:4,storage:{setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},key:'draft.user-a',delay:1e6,onState:s=>states.push(s),...extra});return {sync,saved,states};}
test('save serializes edits and uses acknowledged revisions for the next write',async()=>{
  const requests=[];let finish;const {sync,saved}=setup(async body=>{requests.push(body);if(requests.length===1)await new Promise(resolve=>finish=resolve);return {revision:body.revision+1};});
  sync.queue({title:'first'});const first=sync.pump();sync.queue({title:'latest'});finish();await first;await sync.flush();
  assert.deepEqual(requests,[{revision:4,workspace:{title:'first'}},{revision:5,workspace:{title:'latest'}}]);assert.equal(sync.revision,6);assert.equal(sync.dirty,false);assert.equal(saved.size,0);sync.dispose();
});
test('a conflict retains the latest draft and stops automatic writes',async()=>{
  let requests=0;const {sync,saved}=setup(async()=>{requests++;throw Object.assign(Error('conflict'),{status:409});});
  sync.queue({title:'my draft'});await sync.flush();assert.equal(sync.blocked,'conflict');assert.equal(sync.dirty,true);assert.equal(requests,1);assert.deepEqual(JSON.parse(saved.get(sync.key)),{revision:4,workspace:{title:'my draft'}});
  sync.queue({title:'newer draft'});await sync.flush();assert.equal(requests,1);assert.equal(JSON.parse(saved.get(sync.key)).workspace.title,'newer draft');sync.dispose();
});
test('network failure retries the latest content; session expiry blocks until reauthentication',async()=>{
  let failure=true;const {sync}=setup(async body=>{if(failure)throw Error('offline');return {revision:body.revision+1};});sync.queue({a:1});await sync.pump();assert.equal(sync.blocked,null);assert.equal(sync.dirty,true);sync.queue({a:2});failure=false;await sync.flush();assert.equal(sync.dirty,false);sync.dispose();
  const second=setup(async()=>{throw Object.assign(Error('expired'),{status:401});}).sync;second.queue({a:3});await second.flush();assert.equal(second.blocked,'auth');assert.equal(second.dirty,true);second.dispose();
});
test('recovery resumes only against the same revision and discarded drafts stay discarded',async()=>{
  const {sync,saved}=setup(async b=>({revision:b.revision+1}));sync.recover({revision:3,workspace:{mine:true}});assert.equal(sync.blocked,'conflict');await sync.flush();assert.equal(sync.revision,4);sync.dispose();saved.clear();sync.queue({mine:false});assert.equal(saved.size,0);
  const other=setup(async b=>({revision:b.revision+1})).sync;other.recover({revision:4,workspace:{restored:true}});await other.flush();assert.equal(other.revision,5);other.dispose();
});
test('backend round-trip fixture includes valid frontend nodes, entries, edges and project state',async()=>{
  const source=JSON.parse(await readFile(new URL('../backend/tests/fixtures/workspace.json',import.meta.url),'utf8'));assert.deepEqual(validateWorkspace(source),source);assert.ok(source.projects[0].document.nodes.some(n=>n.innerFunctions?.length));
});
test('one tab acknowledging a save does not erase another tab recovery draft',async()=>{
  const drafts=new Map(),storage={setItem:(k,v)=>drafts.set(k,v),removeItem:k=>drafts.delete(k)};
  const first=setup(async b=>({revision:b.revision+1}),{storage,key:'user-a.tab-one'}).sync;
  const second=setup(async()=>{throw Object.assign(Error('conflict'),{status:409});},{storage,key:'user-a.tab-two'}).sync;
  first.queue({one:true});second.queue({two:true});await second.flush();await first.flush();assert.equal(drafts.has(first.key),false);assert.equal(JSON.parse(drafts.get(second.key)).workspace.two,true);first.dispose();second.dispose();
});
