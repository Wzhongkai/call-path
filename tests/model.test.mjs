import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,reconcileLines,repairAnchors,traceNodes,filterNodes,deleteNode,deleteEdge,validateDocument,scopePath,canParent,assignNodeTag,setBlockPosition,clone} from '../dist/model.js';
test('demo and JSON roundtrip retain valid line anchors, linked returns and groups',()=>{const doc=createDemo();assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))),doc);});
test('inserting before a call retains its original line identity',()=>{const doc=createDemo(),n=doc.nodes[0],edge=doc.edges[0],id=edge.fromLine;n.code=reconcileLines(n.code,'// extra header\n'+n.code.map(l=>l.text).join('\n'));assert.equal(n.code[2].id,id);assert.equal(repairAnchors(doc),0);});
test('removing a connected line detaches safely to function level',()=>{const doc=createDemo(),n=doc.nodes[0],id=doc.edges[0].fromLine;n.code=reconcileLines(n.code,n.code.filter(l=>l.id!==id).map(l=>l.text).join('\n'));assert.ok(repairAnchors(doc)>0);assert.equal(doc.edges[0].fromLine,null);assert.doesNotThrow(()=>validateDocument(doc));});
test('cyclic calls terminate during upstream and downstream tracing',()=>{const doc=createDemo();doc.edges.push({...doc.edges[0],id:'cycle',from:'validate',to:'login'});assert.equal(traceNodes(doc,'login','downstream').size,5);assert.deepEqual([...traceNodes(doc,'find','upstream')].sort(),['find','login','validate']);});
test('multiple tag filtering handles OR and AND',()=>{const doc=createDemo();assert.equal(filterNodes(doc,{tags:['认证','数据']}).size,5);assert.deepEqual([...filterNodes(doc,{tags:['认证','数据'],matchAll:true})],['find']);assert.deepEqual([...filterNodes(doc,{search:'邮箱'} )].sort(),['find','validate']);});
test('deleting a call removes linked returns and deleting a node cleans group membership',()=>{const doc=createDemo();deleteEdge(doc,'call1');assert.ok(!doc.edges.some(e=>e.id==='ret1'));deleteNode(doc,'find');assert.ok(!doc.groups.some(g=>g.members.includes('find')));assert.doesNotThrow(()=>validateDocument(doc));});
test('imports reject bad edges, duplicate line IDs and ambiguous group ownership',()=>{let doc=createDemo();doc.edges[0].to='missing';assert.throws(()=>validateDocument(doc));doc=createDemo();doc.nodes[0].code[1].id=doc.nodes[0].code[0].id;assert.throws(()=>validateDocument(doc));doc=createDemo();doc.groups[1].members.push('validate');assert.throws(()=>validateDocument(doc));});
test('older documents without groups remain importable',()=>{const doc=createDemo();delete doc.groups;assert.deepEqual(validateDocument(doc).groups,[]);});
test('nested scopes retain function identities and reject cyclic parentage',()=>{const doc=createDemo();doc.nodes[1].parentId='login';assert.equal(scopePath(doc,doc.nodes[1]),'handleLogin / validateInput');assert.equal(canParent(doc,'login','validate'),false);assert.doesNotThrow(()=>validateDocument(doc));doc.nodes[0].parentId='validate';assert.throws(()=>validateDocument(doc));doc.nodes[0].parentId=null;deleteNode(doc,'login');assert.equal(doc.nodes.find(n=>n.id==='validate').parentId,null);});
test('file ownership is retained in imports and searchable by path',()=>{const doc=createDemo();assert.deepEqual([...filterNodes(doc,{search:'repositories/'})],['find']);assert.equal(validateDocument(doc).nodes[0].file,'src/auth/login.ts');doc.nodes[0].file=42;assert.throws(()=>validateDocument(doc));});
test('structs and macros keep type identity when exported and imported',()=>{const doc=createDemo();doc.nodes[1].kind='struct';doc.nodes[2].kind='macro';assert.equal(validateDocument(doc).nodes[1].kind,'struct');assert.equal(validateDocument(doc).nodes[2].kind,'macro');doc.nodes[1].kind='unsupported';assert.throws(()=>validateDocument(doc));});

test('tag assignment adds membership once and remains compatible with chain filters',()=>{const doc=createDemo();assert.equal(assignNodeTag(doc,'login','登录链'),true);assert.equal(assignNodeTag(doc,'login','登录链'),false);assignNodeTag(doc,'find','登录链');assert.deepEqual([...filterNodes(doc,{tags:['登录链']})],['login','find']);assert.throws(()=>assignNodeTag(doc,'login',' '));assert.throws(()=>assignNodeTag(doc,'missing','登录链'));assert.doesNotThrow(()=>validateDocument(doc));});

test('inner function entry stores only name and stable line reference and survives inserted comments',()=>{
  const doc=createDemo(),node=doc.nodes[0],lineId=node.code[2].id;
  node.innerFunctions=[{id:'inner1',name:'internal_demuxer',lineId}];
  doc.edges.push({...doc.edges[0],id:'inner-call',to:'login',toLine:lineId,toEntry:'inner1'});
  node.code=reconcileLines(node.code,'// inserted explanation\n'+node.code.map(line=>line.text).join('\n'));
  assert.equal(node.code[3].id,lineId);assert.equal(repairAnchors(doc),0);
  const restored=validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored.nodes[0].innerFunctions,node.innerFunctions);assert.equal(restored.edges.at(-1).toEntry,'inner1');
  node.code=node.code.filter(line=>line.id!==lineId);repairAnchors(doc);
  assert.equal(node.innerFunctions.length,0);assert.equal(doc.edges.at(-1).toEntry,null);assert.doesNotThrow(()=>validateDocument(doc));
});

test('inner entry validation rejects missing lines and duplicate interface rows',()=>{const doc=createDemo(),node=doc.nodes[0];node.innerFunctions=[{id:'inner1',name:'inner',lineId:'missing'}];assert.throws(()=>validateDocument(doc));node.innerFunctions=[{id:'inner1',name:'inner',lineId:node.code[1].id},{id:'inner2',name:'another',lineId:node.code[1].id}];assert.throws(()=>validateDocument(doc));});

test('legacy layouts normalize using the selected view without changing the source or code anchors',()=>{
  const legacy=createDemo();for(const block of [...legacy.nodes,...legacy.groups])block.positions.logic={x:-100,y:20};
  const source=clone(legacy),code=validateDocument(legacy,'code'),logic=validateDocument(legacy);
  for(const [index,block] of [...code.nodes,...code.groups].entries()){
    assert.deepEqual(block.positions.logic,block.positions.code);
    assert.deepEqual(block.positions.code,[...source.nodes,...source.groups][index].positions.code);
  }
  for(const block of [...logic.nodes,...logic.groups])assert.deepEqual(block.positions.code,{x:-100,y:20});
  assert.deepEqual(legacy,source);assert.deepEqual(code.edges,legacy.edges);assert.deepEqual(code.nodes[0].code,legacy.nodes[0].code);
});

test('shared positions survive movement in either mode, mutable keyboard references and history roundtrips',()=>{
  const doc=createDemo(),before=clone(doc),block=doc.nodes[0],logicRef=block.positions.logic,codeRef=block.positions.code;
  setBlockPosition(block,{x:1240,y:-80});assert.deepEqual(block.positions.logic,block.positions.code);
  codeRef.x+=20;codeRef.y+=40;setBlockPosition(block,codeRef);
  assert.equal(block.positions.logic,logicRef);assert.equal(block.positions.code,codeRef);
  assert.deepEqual(logicRef,{x:1260,y:-40});
  const group=doc.groups[0];setBlockPosition(group,{x:400,y:300});
  for(const id of group.members){const member=doc.nodes.find(n=>n.id===id);setBlockPosition(member,{x:member.positions.logic.x+40,y:member.positions.logic.y+60});}
  const after=validateDocument(clone(doc),'code');for(const item of [...after.nodes,...after.groups])assert.deepEqual(item.positions.logic,item.positions.code);
  const restored=validateDocument(before);assert.deepEqual(restored,before);assert.notDeepEqual(after.nodes[0].positions,restored.nodes[0].positions);
});
