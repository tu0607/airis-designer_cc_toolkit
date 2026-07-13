// Figma API をスタブして dist/code.js を実行し、書き出しの挙動を検証する。
// Figma の GUI を使わずに回せるので、src/code.ts を触ったら必ずこれを通す。
//   使い方: npm run build && npm test
import fs from 'node:fs';
import vm from 'node:vm';
const CODE = fs.readFileSync(new URL('../dist/code.js', import.meta.url),'utf8');

const V=(id,name,type,valuesByMode,collectionId)=>({id,name,resolvedType:type,valuesByMode,variableCollectionId:collectionId});
const ALIAS=(id)=>({type:'VARIABLE_ALIAS',id});

function run(fx){
  const posted=[];
  const figma={
    fileKey:'K', showUI(){}, ui:{postMessage:m=>posted.push(m),onmessage:null}, closePlugin(){},
    loadAllPagesAsync:async()=>{},
    variables:{
      getLocalVariableCollectionsAsync:async()=>fx.collections,
      getLocalVariablesAsync:async()=>fx.variables,
      getVariableByIdAsync:async(id)=>fx.remote[id]||null,
    },
    getLocalTextStylesAsync:async()=>[], getLocalEffectStylesAsync:async()=>[],
    getLocalPaintStylesAsync:async()=>[], getLocalGridStylesAsync:async()=>[],
    root:{findAllWithCriteria:({types})=>types.includes('COMPONENT_SET')?(fx.componentSets||[]):(fx.components||[])},
  };
  vm.runInContext(CODE, vm.createContext({figma,__html__:'',console}), {filename:'code.js'});
  return posted;
}

// buildBundle() は module 読み込み時に走る非同期処理なので、postMessage を待つ
async function runAsync(fx){
  const posted = run(fx);
  for (let i = 0; i < 50 && posted.length === 0; i++) await new Promise(r => setTimeout(r, 10));
  const err = posted.find(m => m.type === 'error');
  if (err) console.log('  ⚠️ buildBundle が例外: ' + err.message);
  return posted;
}

let pass=0,fail=0;
const t=(n,c,d='')=>{ if(c){pass++;console.log('  ✅ '+n);} else {fail++;console.log('  ❌ '+n+(d?' … '+d:''));} };

// ---- ケース A: 2 つのコレクションが同じパスを定義（ファイル間の二重定義）----
console.log('=== A) ファイルをまたいだ二重定義 ===');
{
  const fx={
    collections:[
      {id:'C1',name:'Primitives',modes:[{modeId:'m1',name:'Value'}]},
      {id:'C2',name:'Legacy',modes:[{modeId:'m2',name:'Value'}]},
    ],
    variables:[
      V('v1','Color/blue/500','COLOR',{m1:{r:0,g:0.6,b:1,a:1}},'C1'),
      V('v2','Color/blue/500','COLOR',{m2:{r:1,g:0,b:0,a:1}},'C2'), // 同じパスを別コレクションが定義
    ],
    remote:{},
  };
  const posted=await runAsync(fx);
  const meta=posted.find(m=>m.type==='tokens')?.bundle['$meta.json'];
  t('二重定義を検出する',
    !!meta && meta.validation.crossFileDuplicates.some(s=>s.indexOf('color.blue.500')>=0),
    JSON.stringify(meta?.validation.crossFileDuplicates));
  t('hasIssues が立つ', posted.find(m=>m.type==='tokens')?.hasIssues === true);
}

// ---- ケース B: 同一コレクションのモード別ファイルは二重定義にしない（誤検知しない）----
console.log('=== B) モード別ファイルは誤検知しない ===');
{
  const fx={
    collections:[{id:'C1',name:'Tokens',modes:[{modeId:'m1',name:'Light'},{modeId:'m2',name:'Dark'}]}],
    variables:[V('v1','text/primary','COLOR',{m1:{r:0,g:0,b:0,a:1},m2:{r:1,g:1,b:1,a:1}},'C1')],
    remote:{},
  };
  const posted=await runAsync(fx);
  const meta=posted.find(m=>m.type==='tokens')?.bundle['$meta.json'];
  t('Light/Dark の同一パスは二重定義にしない',
    !!meta && meta.validation.crossFileDuplicates.length===0,
    JSON.stringify(meta?.validation.crossFileDuplicates));
}

// ---- ケース C: リモート変数が複数モードを持つ（モード落ちの記録）----
console.log('=== C) リモートのモード落ちを記録 ===');
{
  const fx={
    collections:[{id:'C1',name:'Tokens',modes:[{modeId:'m1',name:'Light'}]}],
    variables:[V('v1','text/high','COLOR',{m1:ALIAS('R1')},'C1')],
    remote:{ R1: V('R1','Color/gray/900','COLOR',{ra:{r:0.1,g:0.1,b:0.1,a:1}, rb:{r:1,g:1,b:1,a:1}},'CR') },
  };
  const posted=await runAsync(fx);
  const meta=posted.find(m=>m.type==='tokens')?.bundle['$meta.json'];
  t('モード落ちを記録する',
    !!meta && meta.validation.droppedRemoteModes.length===1,
    JSON.stringify(meta?.validation.droppedRemoteModes));
  t('リモート変数一覧にも載る',
    !!meta && meta.validation.remoteVariables.length===1,
    JSON.stringify(meta?.validation.remoteVariables));
}

// ---- ケース D: どうしても解決できない id は @ で温存し記録する ----
console.log('=== D) 解決できない変数 ===');
{
  const fx={
    collections:[{id:'C1',name:'Tokens',modes:[{modeId:'m1',name:'Light'}]}],
    variables:[V('v1','text/ghost','COLOR',{m1:ALIAS('GONE')},'C1')],
    remote:{},
  };
  const posted=await runAsync(fx);
  const b=posted.find(m=>m.type==='tokens')?.bundle;
  t('空文字ではなく @id を残す',
    b?.['semantic.json']?.text?.ghost?.$value === '@GONE',
    JSON.stringify(Object.keys(b||{})) + ' / ' + JSON.stringify(b?.['semantic.json']));
  t('未解決として記録する',
    b?.['$meta.json'].validation.unresolvedAliases.length >= 1,
    JSON.stringify(b?.['$meta.json'].validation.unresolvedAliases));
}

// ---- ケース E: ローカルと同名のリモート変数は remote.json に出さない ----
// 自ファイルの公開ライブラリを購読していると、同じ変数がローカル版とライブラリ版で
// 別 id として存在し、コンポーネントがライブラリ版に束縛される。
// パスで解決できるので remote 側に出す必要がなく、出すと二重定義になる。
console.log('=== E) ローカルと同名のリモート変数は出力しない ===');
{
  const fx={
    collections:[{id:'C1',name:'Primitives',modes:[{modeId:'m1',name:'Value'}]}],
    variables:[
      V('v1','Color/blue/500','COLOR',{m1:{r:0,g:0.6,b:1,a:1}},'C1'),
      V('v2','size/2','FLOAT',{m1:16},'C1'),
    ],
    // R1/R2 はローカルと同名（ライブラリ版）／R3 はローカルに無い
    remote:{
      R1: V('R1','Color/blue/500','COLOR',{ra:{r:0,g:0.6,b:1,a:1}},'CR'),
      R2: V('R2','size/2','FLOAT',{ra:16},'CR'),
      R3: V('R3','size/4_5','FLOAT',{ra:36},'CR'),
    },
  };
  // コンポーネントがライブラリ版に束縛されている状況を作る
  const variant={id:'1:2',name:'State=Default',type:'COMPONENT',variantProperties:{State:'Default'},
    boundVariables:{fills:ALIAS('R1'),paddingLeft:ALIAS('R2'),height:ALIAS('R3')},children:[]};
  fx.componentSets=[{id:'1:1',name:'Thing',type:'COMPONENT_SET',
    componentPropertyDefinitions:{},children:[variant]}];

  const posted=await runAsync(fx);
  const b=posted.find(m=>m.type==='tokens')?.bundle;
  const meta=b?.['$meta.json'];

  t('★ ローカルと同名のリモート変数は remote.json に出さない',
    b?.['remote.json'] && b['remote.json'].color === undefined,
    JSON.stringify(b?.['remote.json']));
  t('★ ローカルに無いものだけ remote.json に出す',
    b?.['remote.json']?.space?.['4_5']?.$value === '36px',
    JSON.stringify(b?.['remote.json']));
  t('★ ファイルをまたいだ二重定義が 0 件になる',
    meta?.validation.crossFileDuplicates.length === 0,
    JSON.stringify(meta?.validation.crossFileDuplicates));
  t('★ remote 内のトークン名衝突が 0 件になる',
    meta?.validation.pathConflicts.filter(x=>x.indexOf('remote:')===0).length === 0,
    JSON.stringify(meta?.validation.pathConflicts));
  t('★ ライブラリ版に束縛されている事実を記録する',
    meta?.validation.libraryBoundToLocalNames.length === 1 &&
      meta.validation.libraryBoundToLocalNames[0].indexOf('2 件') === 0,
    JSON.stringify(meta?.validation.libraryBoundToLocalNames));
  t('参照は解決できる（dangling 0 件）',
    meta?.validation.danglingRefs.length === 0,
    JSON.stringify(meta?.validation.danglingRefs));
}

console.log(`\n=== 追加検査: ${pass} 件成功 / ${fail} 件失敗 ===`);
process.exit(fail>0?1:0);
