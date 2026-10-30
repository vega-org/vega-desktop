import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

for (const repo of ['vega-desktop', 'vega-mobile']) {
  test(`${repo}: only declared buttons invoke the sandbox action with the source scope`, async () => {
    const source=fs.readFileSync(new URL(`../../${repo}/src/lib/services/ProviderManager.ts`,import.meta.url),'utf8');
    const start=source.indexOf('  runSettingsAction = async');
    const end=source.indexOf('  getSettingsSchema = async',start);
    const method=source.slice(start,end);
    const code=ts.transpileModule(`export class Manager {${method}}`,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    const {Manager}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const scope=repo==='vega-mobile'?'author:provider':'author/provider';
    // Match desktop's imported source-scope helper without running any provider.
    const withScope=code.replace('export class Manager', `const providerScopeId=(author,value)=>author+'/'+value; export class Manager`);
    const Actual=repo==='vega-mobile'?Manager:(await import(`data:text/javascript;base64,${Buffer.from(withScope).toString('base64')}`)).Manager;
    const manager=new Actual();
    manager.settingsActionModules=new Map([[scope,{code:'settings module',author:'author'}]]);
    manager.getSettingsSchema=async()=>[{type:'button',key:'refresh'},{type:'text',key:'token'}];
    const calls=[];
    manager.executeModule=async(...args)=>calls.push(args);
    await manager.runSettingsAction({providerValue:'provider',sourceAuthor:'author',key:'refresh'});
    assert.deepEqual(calls,[[{code:'settings module',author:'author'},'provider','onSettingsAction',{key:'refresh'}]]);
    await assert.rejects(manager.runSettingsAction({providerValue:'provider',sourceAuthor:'author',key:'token'}),/Unknown/);
    assert.equal(calls.length,1);
    manager.executeModule=async()=>{throw new Error('Refresh failed');};
    await assert.rejects(manager.runSettingsAction({providerValue:'provider',sourceAuthor:'author',key:'refresh'}),/Refresh failed/);
  });
}
