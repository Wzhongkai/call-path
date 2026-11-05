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
const callSyntax=/^(CallExpression|CallExpr|NewExpression|MethodInvocation|ObjectCreationExpression|MacroInvocation|ExplicitConstructorInvocation|TaggedTemplateExpression)$/;
// Use the same language parser as the editor to distinguish code from strings and comments.
export function analyzeCodePreview(lines,language='javascript'){
  const text=lines.map(line=>line.text).join('\n'),parser=languageExtension(language)?.language?.parser;
  const comments=[],braces=[],calls=[],starts=[0];
  for(const line of lines)starts.push(starts.at(-1)+line.text.length+1);
  function lineAt(offset){
    let low=0,high=lines.length;
    while(low+1<high){const mid=(low+high)>>>1;if(starts[mid]<=offset)low=mid;else high=mid;}
    return low;
  }
  if(parser)parser.parse(text).iterate({enter(node){
    if(/comment/i.test(node.name)){comments.push({from:node.from,to:node.to});return false;}
    if(lines.length<40)return;
    if(callSyntax.test(node.name))calls.push([lineAt(node.from),lineAt(Math.max(node.from,node.to-1))]);
    if(node.name==='{'&&node.from<node.to){
      const close=node.node.parent?.lastChild;
      if(close?.name==='}'&&close.from<close.to){
        const start=lineAt(node.from),end=lineAt(close.from);
        if(end-start>=7)braces.push({start,end});
      }
    }
  }});
  return {comments,braces,calls};
}
export function codePreviewLines(lines,language='javascript',analysis=analyzeCodePreview(lines,language)){
  let firstComment=0;
  let offset=0;
  return lines.map((line,index)=>{
    const start=offset,end=start+line.text.length;offset=end+1;
    const {comments}=analysis;
    while(firstComment<comments.length&&comments[firstComment].to<=start)firstComment++;
    let clean=line.text,hasComment=false;
    for(let i=firstComment;i<comments.length&&comments[i].from<end;i++){
      const range=comments[i],from=Math.max(0,range.from-start),to=Math.min(line.text.length,range.to-start);
      clean=clean.slice(0,from)+' '.repeat(to-from)+clean.slice(to);
      hasComment=true;
    }
    return {...line,index,text:hasComment?clean.trimEnd():clean,commentOnly:hasComment&&!clean.trim()};
  });
}
// Compact only the preview; retain source indices and any externally used anchors.
export function compactPreviewLines(lines,anchorIds=new Set()){
  return lines.flatMap(line=>{
    if(!line.commentOnly&&line.text.trim())return [line];
    if(!anchorIds.has(line.id))return [];
    return [{...line,text:'',...(line.commentOnly?{hiddenCommentAnchor:true}:{hiddenBlankAnchor:true})}];
  });
}
export function foldPreviewLines(visibleLines,sourceLines,analysis,anchorIds,expanded=new Set()){
  if(!analysis.braces.length)return visibleLines;
  const protectedLines=new Int32Array(sourceLines.length+1);
  for(const [start,end] of analysis.calls){protectedLines[start]++;protectedLines[end+1]--;}
  let calls=0,protectedCount=0;
  for(const [index,line] of sourceLines.entries()){
    calls+=protectedLines[index];
    protectedLines[index]=protectedCount;
    if(calls||anchorIds.has(line.id))protectedCount++;
  }
  protectedLines[sourceLines.length]=protectedCount;
  const result=[];
  let row=0,lastEnd=0;
  for(const {start,end} of analysis.braces){
    if(start<lastEnd||protectedLines[end]!==protectedLines[start+1])continue;
    while(row<visibleLines.length&&visibleLines[row].index<=start)result.push(visibleLines[row++]);
    // Comments and blank rows may have already compacted this range.
    if(row+1>=visibleLines.length||visibleLines[row+1].index>=end)continue;
    const key=start+'-'+end,isExpanded=expanded.has(key);
    result.push({fold:{key,start,end,expanded:isExpanded}});
    if(!isExpanded)while(row<visibleLines.length&&visibleLines[row].index<end)row++;
    lastEnd=end;
  }
  return result.concat(visibleLines.slice(row));
}
export function changedLineRanges(changes,before,after){
  const ranges=[];
  changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
    const start=before.lineAt(fromA).number-1,end=before.lineAt(toA).number;
    const newStart=after.lineAt(fromB).number-1,newEnd=after.lineAt(toB).number;
    const last=ranges.at(-1);
    if(last&&(start<last.end||newStart<last.newEnd)){
      last.end=end;last.newEnd=newEnd;
    }else ranges.push({start,end,newStart,newEnd});
  });
  return ranges;
}
export function createCodeEditor({parent,doc,language='javascript',indentSize=4,onChange,readOnly=false}){
  const languageSlot=new Compartment(),indentSlot=new Compartment();
  const view=new EditorView({parent,state:EditorState.create({doc,extensions:[
    basicSetup,keymap.of([indentWithTab]),oneDark,EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),
    languageSlot.of(languageExtension(language)),indentSlot.of(indentationExtensions(indentSize)),
    EditorView.contentAttributes.of({'aria-label':'代码编辑器','aria-readonly':String(readOnly),tabindex:'0',spellcheck:'false'}),
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
    EditorView.updateListener.of(update=>{
      if(update.docChanged)onChange(update.state.doc.toString(),changedLineRanges(update.changes,update.startState.doc,update.state.doc));
    })
  ]})});
  return {view,reveal(from,to=from){view.dispatch({selection:{anchor:from,head:to},effects:EditorView.scrollIntoView(from,{y:"center"})});view.focus();},setLanguage(type){view.dispatch({effects:languageSlot.reconfigure(languageExtension(type))});},setIndentSize(size){view.dispatch({effects:indentSlot.reconfigure(indentationExtensions(size))});},destroy(){view.destroy();},measure(){view.requestMeasure();}};
}
