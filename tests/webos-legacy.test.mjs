import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {legacyCss,legacySandboxWasm,lowerLibmediaChunk} from '../scripts/legacy-webos.mjs';
import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten';
import variant from '@jitl/quickjs-ng-wasmfile-release-sync';
import ts from 'typescript';

test('Node 8 service compatibility preserves cancellation and safe header keys',async()=>{
  const fs={stat:(_name,callback)=>callback(null,{size:42})};
  const dns={lookup:(_name,_options,callback)=>callback(null,[{address:'93.184.216.34',family:4}])};
  const context=vm.createContext({require:name=>name==='fs'?fs:name==='dns'?dns:createRequire(import.meta.url)(name)});
  vm.runInContext('global=this;Object.fromEntries=undefined;String.prototype.trimStart=undefined;',context);
  vm.runInContext(await readFile(new URL('../tv/webos/legacy/node8-compat.cjs',import.meta.url),'utf8'),context);
  assert.equal(await vm.runInContext('require("fs").promises.stat("fixture").then(value=>value.size)',context),42);
  assert.equal(await vm.runInContext('require("dns").promises.lookup("example.com",{all:true}).then(value=>value[0].family)',context),4);
  assert.equal(vm.runInContext(`(function(){const c=new AbortController();let count=0;const reason=new Error('stop');c.signal.addEventListener('abort',()=>count++,{once:true});c.abort(reason);c.abort();try{c.signal.throwIfAborted()}catch(e){return count===1&&e===reason}})()`,context),true);
  assert.equal(vm.runInContext(`Object.prototype.hasOwnProperty.call(Object.fromEntries([['__proto__','safe']]),'__proto__')`,context),true);
  assert.equal(vm.runInContext('new URL("https://example.com/path").hostname',context),'example.com');
});

test('legacy stylesheet removes unsupported layers, colors and sizing syntax',async()=>{
  const css=await legacyCss('@layer controls{.panel{display:flex;gap:12px;inset:0;background:color-mix(in srgb,var(--primary) 50%,transparent);width:clamp(10px,50vw,100px);aspect-ratio:16 / 9}}');
  assert.doesNotMatch(css,/@layer|color-mix\(|clamp\(/);
  assert.match(css,/top:\s*0/);
  assert.match(css,/--legacy-aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css,/--fgp-gap-column:\s*12px/);
  assert.match(css,/\.tv-focus[^\{]*\{outline:none!important/);
});

test('lowered current QuickJS retains execution and memory limits',async()=>{
  const require=createRequire(import.meta.url);
  const bytes=await legacySandboxWasm(await readFile(require.resolve('@jitl/quickjs-ng-wasmfile-release-sync/wasm')));
  const compiled=await WebAssembly.compile(bytes);
  const engine=await newQuickJSWASMModuleFromVariant(newVariant(variant,{wasmModule:compiled}));
  const runtime=engine.newRuntime();runtime.setMemoryLimit(16*1024*1024);
  const context=runtime.newContext();
  try{
    const result=context.evalCode('21 * 2');
    const value=context.unwrapResult(result);
    try{assert.equal(context.getNumber(value),42);}finally{value.dispose();}
    context.unwrapResult(context.evalCode('typeof window')).dispose();
  }finally{context.dispose();runtime.dispose();}
});

test('missing WASM globals are reported before libmedia import without substituting an engine',async()=>{
  const source=await readFile(new URL('../src/lib/player/libmediaRuntime.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const {getLibmediaRuntimeError}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.match(getLibmediaRuntimeError({}),/WebAssembly.Global/);
  assert.match(getLibmediaRuntimeError({}),/no alternative player/);
  assert.equal(getLibmediaRuntimeError(WebAssembly),null);
});

test('webOS 23 CSS lowers layers/colors while retaining supported layout features',async()=>{
  const css=await legacyCss('@layer base{*{padding:0}}.player{padding:20px;display:flex;gap:12px;width:clamp(10px,50vw,100px);aspect-ratio:16/9;background:color-mix(in srgb,var(--primary) 50%,transparent)}',{chrome:94});
  assert.doesNotMatch(css,/@layer|color-mix\(/);
  assert.match(css,/clamp\(/);
  assert.match(css,/aspect-ratio:16\/9/);
  assert.doesNotMatch(css,/--fgp-/);
});

test('separately loaded libmedia chunks retain behavior after Chrome 94 lowering',async()=>{
  const code=await lowerLibmediaChunk('globalThis.result = [1,2].map(value => value + 1);',94);
  const context=vm.createContext({});vm.runInContext(code,context);
  assert.equal(vm.runInContext('JSON.stringify(result)',context),'[2,3]');
});
