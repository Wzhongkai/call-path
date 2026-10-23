import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
await mkdir(new URL('../dist/vendor/',import.meta.url),{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('../src/editor.js',import.meta.url))],bundle:true,format:'esm',target:'es2022',minify:true,outfile:fileURLToPath(new URL('../dist/vendor/editor.js',import.meta.url)),legalComments:'eof'});
console.log('Built dist/vendor/editor.js');
