import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightCode} from '../dist/highlight.js';
test('editor highlights language-specific keywords, literals and comments safely',()=>{
  assert.match(highlightCode('fn main() { let n = 42; }','rust'),/syntax-keyword">fn/);
  assert.match(highlightCode('fn main() { let n = 42; }','rust'),/syntax-number">42/);
  const py=highlightCode('def inner():\n  return "# value" # comment','python');assert.match(py,/syntax-keyword">def/);assert.match(py,/syntax-string/);assert.match(py,/syntax-comment"># comment/);
  assert.match(highlightCode('select * from users -- note','sql'),/syntax-comment/);
  assert.equal(highlightCode('<script>alert(1)</script>','plain'),'&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!highlightCode('const x = "<img src=x>";','javascript').includes('<img'));
});
test('function tokens can expose jump targets while keywords remain non-links',()=>{
  const html=highlightCode('return inner(value);','javascript',name=>`data-name="${name}"`);assert.match(html,/syntax-function" data-name="inner"/);assert.ok(!html.includes('data-name="return"'));
});
test('struct and macro identifiers can link independently from function calls',()=>{const html=highlightCode('struct port_bucket *bucket; return LIMIT;','c',null,name=>['port_bucket','LIMIT'].includes(name)?`data-ref="${name}"`:'');assert.match(html,/syntax-reference" data-ref="port_bucket"/);assert.match(html,/syntax-reference" data-ref="LIMIT"/);assert.ok(!html.includes('data-ref="bucket"'));});
