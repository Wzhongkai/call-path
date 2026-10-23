import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {insertNewlineAndIndent,indentMore,indentLess} from '@codemirror/commands';
import {languageExtension,indentationExtensions,codePreviewLines,compactPreviewLines} from '../src/editor.js';
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
