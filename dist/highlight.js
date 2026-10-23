export const LANGUAGES={javascript:'JavaScript',typescript:'TypeScript',python:'Python',rust:'Rust',c:'C',cpp:'C++',java:'Java',go:'Go',sql:'SQL',json:'JSON',plain:'纯文本'};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keywordText={
  javascript:'async await function const let var return if else throw new true false null undefined class extends constructor import export default from try catch finally for while do break continue switch case of in this super typeof instanceof yield static get set',
  typescript:'async await function const let var return if else throw new true false null undefined class extends constructor import export default from try catch finally for while do break continue switch case of in this super typeof instanceof yield static get set interface type enum implements public private protected readonly declare namespace abstract as keyof unknown any never string number boolean void',
  python:'def async await return if elif else try except finally raise class import from as for while break continue in is not and or lambda yield with pass True False None global nonlocal assert del',
  rust:'fn let mut pub use mod crate super self Self impl trait struct enum type const static async await move return if else match loop while for in break continue where dyn ref unsafe extern true false Some None Ok Err as',
  c:'auto const static extern volatile register restrict void char short int long float double signed unsigned struct union enum typedef sizeof return if else switch case default break continue for while do goto',
  cpp:'auto const constexpr static extern volatile void char short int long float double signed unsigned struct union enum typedef sizeof return if else switch case default break continue for while do namespace using class public private protected template typename virtual override final new delete try catch throw true false nullptr this noexcept',
  java:'package import class interface enum public private protected static final abstract synchronized volatile void boolean byte char short int long float double new return if else switch case default break continue for while do try catch finally throw throws extends implements this super true false null',
  go:'package import func var const type struct interface map chan go defer return if else switch case default break continue for range select fallthrough true false nil',
  sql:'SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER ON AS INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX DROP ALTER AND OR NOT NULL IS IN EXISTS CASE WHEN THEN ELSE END GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT ASC DESC COUNT SUM AVG MIN MAX BEGIN COMMIT',
  json:'true false null',plain:''
};
const keywords=Object.fromEntries(Object.entries(keywordText).map(([key,text])=>[key,new Set(text.split(' '))]));
export function highlightCode(text,language='javascript',functionAttrs=null,identifierAttrs=null){
  if(language==='plain')return escape(text);
  if(!keywords[language])language='javascript';
  const comments=language==='python'?'#[^\\n]*':language==='sql'?'--[^\\n]*|/\\*[\\s\\S]*?\\*/':'//[^\\n]*|/\\*[\\s\\S]*?\\*/';
  const pattern=new RegExp(`(${comments}|"""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\\\r\\n])*'|\u0060(?:\\\\.|[^\u0060\\\\])*\u0060|\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?)(?:[uif]\\d+)?\\b|\\b[A-Za-z_$][\\w$]*\\b)`,'g');
  let out='',last=0,match;
  while((match=pattern.exec(text))){const value=match[0],index=match.index;out+=escape(text.slice(last,index));let cls='';
    if(value.startsWith('//')||value.startsWith('/*')||(language==='python'&&value.startsWith('#'))||(language==='sql'&&value.startsWith('--')))cls='comment';
    else if(/^["'`]/.test(value))cls='string';
    else if(keywords[language].has(language==='sql'?value.toUpperCase():value))cls='keyword';
    else if(/^\d/.test(value))cls='number';
    else if(/^\s*\(/.test(text.slice(index+value.length)))cls='function';
    let attrs=cls==='function'&&functionAttrs?functionAttrs(value):'';
    if(!cls&&identifierAttrs&&/^[A-Za-z_$][\w$]*$/.test(value)){attrs=identifierAttrs(value);if(attrs)cls='reference';}
    out+=cls?`<span class="syntax-${cls}"${attrs?' '+attrs:''}>${escape(value)}</span>`:escape(value);last=index+value.length;
  }
  return out+escape(text.slice(last));
}
