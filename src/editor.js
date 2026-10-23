import {basicSetup} from 'codemirror';
import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {indentWithTab} from '@codemirror/commands';
import {indentUnit} from '@codemirror/language';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {rust} from '@codemirror/lang-rust';
import {cpp} from '@codemirror/lang-cpp';
import {java} from '@codemirror/lang-java';
import {go} from '@codemirror/lang-go';
import {sql} from '@codemirror/lang-sql';
import {json} from '@codemirror/lang-json';
import {oneDark} from '@codemirror/theme-one-dark';

export function languageExtension(type){return ({javascript:()=>javascript(),typescript:()=>javascript({typescript:true}),python,rust,c:cpp,cpp,java,go,sql,json,plain:()=>[]}[type]||javascript)();}
export function indentationExtensions(size){return [EditorState.tabSize.of(size),indentUnit.of(' '.repeat(size))];}
// Parse comments with the selected language so comment-like strings stay intact.
export function codePreviewLines(lines,language='javascript'){
  const text=lines.map(line=>line.text).join('\n'),parser=languageExtension(language)?.language?.parser,ranges=[];
  if(parser)parser.parse(text).iterate({enter(node){if(/comment/i.test(node.name)){ranges.push({from:node.from,to:node.to});return false;}}});
  let offset=0;
  return lines.map((line,index)=>{
    const start=offset,end=start+line.text.length;offset=end+1;
    const comments=ranges.filter(range=>range.from<=end&&range.to>start);
    let clean=line.text;
    for(const range of comments){const from=Math.max(0,range.from-start),to=Math.min(line.text.length,range.to-start);clean=clean.slice(0,from)+' '.repeat(to-from)+clean.slice(to);}
    return {...line,index,text:comments.length?clean.trimEnd():clean,commentOnly:comments.length>0&&!clean.trim()};
  });
}
export function createCodeEditor({parent,doc,language='javascript',indentSize=4,onChange}){
  const languageSlot=new Compartment(),indentSlot=new Compartment();
  const view=new EditorView({parent,state:EditorState.create({doc,extensions:[
    basicSetup,keymap.of([indentWithTab]),oneDark,
    languageSlot.of(languageExtension(language)),indentSlot.of(indentationExtensions(indentSize)),
    EditorView.contentAttributes.of({'aria-label':'代码编辑器',spellcheck:'false'}),
    EditorView.theme({
      '&':{height:'100%',backgroundColor:'#101a2a',color:'#d0dced',fontSize:'13px'},
      '.cm-scroller':{fontFamily:'"IBM Plex Mono",Consolas,monospace',lineHeight:'1.8',overflow:'auto'},
      '.cm-content':{padding:'13px 0',caretColor:'#9cd6ff'},
      '.cm-line':{padding:'0 12px'},
      '.cm-gutters':{backgroundColor:'#142135',color:'#7c93b1',border:'none',paddingRight:'5px'},
      '.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'#65b9ff0c'},
      '.cm-cursor':{borderLeftColor:'#9cd6ff'},
      '&.cm-focused':{outline:'none'},
      '.cm-panels':{backgroundColor:'#1c3049',color:'#c5def7'},
      '.cm-search input':{backgroundColor:'#101f32',color:'#d1e6fb',border:'1px solid #4b6b91',borderRadius:'3px'},
      '.cm-tooltip':{backgroundColor:'#1c2e46',border:'1px solid #4b6b91'}
    }),
    EditorView.updateListener.of(update=>{if(update.docChanged)onChange(update.state.doc.toString());})
  ]})});
  return {view,reveal(from,to=from){view.dispatch({selection:{anchor:from,head:to},effects:EditorView.scrollIntoView(from,{y:"center"})});view.focus();},setLanguage(type){view.dispatch({effects:languageSlot.reconfigure(languageExtension(type))});},setIndentSize(size){view.dispatch({effects:indentSlot.reconfigure(indentationExtensions(size))});},destroy(){view.destroy();},measure(){view.requestMeasure();}};
}
