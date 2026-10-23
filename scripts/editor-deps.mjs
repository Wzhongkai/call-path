import {readFile,writeFile} from 'node:fs/promises';
const names=['codemirror','@codemirror/state','@codemirror/view','@codemirror/commands','@codemirror/language','@codemirror/lang-javascript','@codemirror/lang-python','@codemirror/lang-rust','@codemirror/lang-cpp','@codemirror/lang-java','@codemirror/lang-go','@codemirror/lang-sql','@codemirror/lang-json','@codemirror/theme-one-dark','esbuild'];
const entries=await Promise.all(names.map(async name=>{const r=await fetch('https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest');if(!r.ok)throw Error(name+': '+r.status);const data=await r.json();return [name,data.version];}));
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
manifest.packageManager='pnpm@11.25.0';manifest.dependencies=Object.fromEntries(entries.filter(([name])=>name!=='esbuild'));manifest.devDependencies=Object.fromEntries(entries.filter(([name])=>name==='esbuild'));manifest.scripts['build:editor']='node scripts/build-editor.mjs';
await writeFile(new URL('../package.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(entries));
