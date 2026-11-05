import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {insertNewlineAndIndent,indentMore,indentLess} from '@codemirror/commands';
import {foldState,foldKeymap} from '@codemirror/language';
import {languageExtension,indentationExtensions,sourceEditorSetup,analyzeCodePreview,codePreviewLines,compactPreviewLines,foldPreviewLines,canvasCodePreview,changedLineRanges} from '../src/editor.js';
import {reconcileLines,createDemo,validateDocument} from '../dist/model.js';
test('C and Rust Enter uses configured automatic indentation',()=>{
  for(const [type,doc] of [['c','int main() {'],['rust','fn main() {']]){
    let state=EditorState.create({doc,selection:{anchor:doc.length},extensions:[languageExtension(type),...indentationExtensions(4)]});
    const target={get state(){return state;},dispatch(tr){state=tr.state;}};
    assert.equal(insertNewlineAndIndent(target),true);assert.match(state.doc.toString(),/\n {4}$/);
  }
});
test('selection indent and dedent preserve both selected code lines',()=>{
  const doc='alpha();\nbeta();';let state=EditorState.create({doc,selection:{anchor:0,head:doc.length},extensions:[languageExtension('javascript'),...indentationExtensions(4)]});
  const target={get state(){return state;},dispatch(tr){state=tr.state;}};
  indentMore(target);assert.equal(state.doc.toString(),'    alpha();\n    beta();');indentLess(target);assert.equal(state.doc.toString(),doc);
});

test('the source editor opens all lines and has no folding state or shortcuts',()=>{
  const doc='int main() {\n  // Keep this comment\n\n  return 0;\n}';
  const state=EditorState.create({doc,extensions:[sourceEditorSetup,languageExtension('c')]});
  assert.equal(state.doc.toString(),doc);
  assert.equal(state.field(foldState,false),undefined);
  const bindings=state.facet(keymap).flat();
  assert.ok(foldKeymap.every(binding=>!bindings.includes(binding)));
  assert.ok(bindings.some(binding=>binding.key==='Mod-f'));
});

test('canvas preview removes real comments but keeps literals, directives and original line identities',()=>{
  const source=['// explanation','const url = "https://example.com"; // note','/* block',' * many notes',' */','call();','const re = /https?:\\/\\//;'];
  const lines=source.map((text,index)=>({id:'line'+index,text}));
  const preview=codePreviewLines(lines,'javascript');
  assert.deepEqual(preview.filter(line=>!line.commentOnly).map(line=>line.id),['line1','line5','line6']);
  assert.equal(preview[1].text,'const url = "https://example.com";');
  assert.equal(preview[6].text,source[6]);assert.deepEqual(lines.map(line=>line.text),source);
  assert.equal(codePreviewLines([{id:'define',text:'#define LIMIT 10 // maximum'}],'c')[0].text,'#define LIMIT 10');
});

test('comment filtering handles language-specific syntax, nested Rust comments and plain text',()=>{
  for(const language of ['c','cpp','java','go','rust','typescript']){
    const rows=codePreviewLines([{id:'comment',text:'/* note */'},{id:'code',text:'call(); // note'}],language);
    assert.equal(rows[0].commentOnly,true,language);assert.equal(rows[1].text,'call();',language);
  }
  assert.equal(codePreviewLines([{id:'py',text:'url = "#keep" # hide'}],'python')[0].text,'url = "#keep"');
  assert.equal(codePreviewLines([{id:'sql',text:"SELECT '--keep'; -- hide"}],'sql')[0].text,"SELECT '--keep';");
  assert.equal(codePreviewLines([{id:'rs',text:'/* outer /* nested */ end */ call();'}],'rust')[0].text.trim(),'call();');
  assert.equal(codePreviewLines([{id:'text',text:'// keep all'}],'plain')[0].text,'// keep all');
});

test('canvas compacts blank and whitespace rows with comments shown or hidden without changing source',()=>{
  const lines=['','function outer() {','  \t','  // note','','  work();','}', ''].map((text,index)=>({id:'line'+index,text}));
  const original=structuredClone(lines);
  const hidden=compactPreviewLines(codePreviewLines(lines));
  assert.deepEqual(hidden.map(({id,index})=>[id,index]),[['line1',1],['line5',5],['line6',6]]);
  const shown=compactPreviewLines(lines.map((line,index)=>({...line,index})));
  assert.deepEqual(shown.map(line=>line.index),[1,3,5,6]);
  assert.equal(shown[1].text,'  // note');
  assert.deepEqual(lines,original);
  assert.deepEqual(compactPreviewLines(codePreviewLines([{id:'blank',text:' \t'}])),[]);
});

test('compacted preview retains blank and hidden comment anchors for edges and internal entries',()=>{
  const lines=['','  ','// note','work();',''].map((text,index)=>({id:'line'+index,text}));
  const anchors=new Set(['line1','line2','line4']);
  const hidden=compactPreviewLines(codePreviewLines(lines),anchors);
  assert.deepEqual(hidden.map(line=>line.index),[1,2,3,4]);
  assert.equal(hidden[0].hiddenBlankAnchor,true);
  assert.equal(hidden[1].hiddenCommentAnchor,true);
  assert.equal(hidden[3].hiddenBlankAnchor,true);
  const shown=compactPreviewLines(lines.map((line,index)=>({...line,index})),anchors);
  assert.equal(shown[0].hiddenBlankAnchor,true);
  assert.equal(shown[1].text,'// note');
});

test('a long brace block folds while calls, multiline arguments, and anchors stay visible',()=>{
  const work=Array.from({length:30},()=> '    total += 1;');
  const source=['int f() {','  if (ready) {','    const char *s = "}"; // {',...work,'  }',
    '  if (done) {','    run(','      total);',...work,'  }',
    '  if (retry) {',...work,'  }','}'];
  const code=source.map((text,index)=>({id:'line'+index,text}));
  const analysis=analyzeCodePreview(code,'c');
  const anchors=new Set([code.at(-3).id]);
  const visible=compactPreviewLines(codePreviewLines(code,'c',analysis),anchors);
  const rows=foldPreviewLines(visible,code,analysis,anchors);
  const folds=rows.filter(row=>row.fold).map(row=>row.fold);
  assert.equal(folds.length,3);
  assert.equal(folds[0].key,'1-33');
  assert.equal(rows.find(row=>row.id==='line2'),undefined);
  for(const line of [1,33,35,36,code.length-3])assert.ok(rows.some(row=>row.index===line));
  const expanded=foldPreviewLines(visible,code,analysis,anchors,new Set(['1-33']));
  assert.deepEqual(expanded.filter(row=>row.index>1&&row.index<33),visible.filter(row=>row.index>1&&row.index<33));
  assert.equal(expanded.find(row=>row.fold).fold.expanded,true);
});

test('short mixed C functions fold work between calls while keeping complete call and control statements',()=>{
  const source=[
    'int f (int flag)', '{', '  begin ();',
    '  int value = 0;', '  value += 1;', '  value += 2;', '  value += 3;', '  value += 4;', '  value += 5;',
    '  value++; if (flag)', '    {', '      finish (', '        value);', '    }',
    '  return value;', '}',
  ];
  const code=source.map((text,index)=>({id:'line'+index,text}));
  const analysis=analyzeCodePreview(code,'c'),anchors=new Set();
  const visible=compactPreviewLines(codePreviewLines(code,'c',analysis),anchors);
  const rows=foldPreviewLines(visible,code,analysis,anchors);
  assert.deepEqual(rows.filter(row=>row.fold).map(({fold})=>[fold.start+1,fold.end-1]),[[3,8]]);
  for(const index of [0,1,2,9,10,11,12,13,14,15])assert.ok(rows.some(row=>row.index===index),source[index]);
});

test('a call-heavy block hides other rows even with no brace folds, preserving unlinked calls and their arguments',()=>{
  const work=Array.from({length:140},()=>['  i += 1;','  step(i);']).flat();
  const source=['int f() {','  int i = 0;',...work,'  finish(','    i);','  return i;','}'];
  const code=source.map((text,index)=>({id:'line'+index,text}));
  const anchors=new Set(['line1','line284']);
  const analysis=analyzeCodePreview(code,'c');
  const visible=compactPreviewLines(codePreviewLines(code,'c',analysis),anchors);
  assert.equal(foldPreviewLines(visible,code,analysis,anchors).length,source.length);
  const compact=canvasCodePreview(visible,code,analysis,anchors);
  const expected=visible.filter(line=>anchors.has(line.id)||/step|finish|    i\);/.test(line.text));
  assert.deepEqual(compact.rows,[...expected,{hiddenRows:source.length-expected.length}]);
  assert.equal(compact.expanded,false);
  const open=canvasCodePreview(visible,code,analysis,anchors,{expanded:true});
  assert.deepEqual(open.rows,visible);
  assert.equal(open.expanded,true);
});

test('10,000-line code validates, folds to a few rows and keeps stable IDs on distant edits',()=>{
  const doc=createDemo(),node=doc.nodes[0];
  const existing=node.code.map(line=>line.text);
  const text=[...existing,'if (ready) {',...Array(10_000).fill('  total += 1;'),'}'].join('\n');
  node.code=reconcileLines(node.code,text);
  assert.equal(validateDocument(doc).nodes[0].code.length,existing.length+10_002);
  const analysis=analyzeCodePreview(node.code);
  const rows=compactPreviewLines(codePreviewLines(node.code,'javascript',analysis));
  assert.equal(foldPreviewLines(rows,node.code,analysis,new Set()).filter(row=>row.fold).length,1);

  const state=EditorState.create({doc:text});
  const edit=state.update({changes:[
    {from:state.doc.line(existing.length+2).from,insert:'  extra += 2;\n'},
    {from:state.doc.line(existing.length+9_000).from,insert:'  other += 2;\n'}
  ]});
  const updated=reconcileLines(node.code,edit.newDoc.toString(),changedLineRanges(edit.changes,state.doc,edit.newDoc));
  assert.equal(updated.map(line=>line.text).join('\n'),edit.newDoc.toString());
  assert.equal(updated[existing.length+5001].id,node.code[existing.length+5000].id);
  assert.equal(updated.at(-2).id,node.code.at(-2).id);
});
