import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {insertNewlineAndIndent,indentMore,indentLess} from '@codemirror/commands';
import {languageExtension,indentationExtensions,codePreviewLines} from '../src/editor.js';
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
