import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten';
import variant from '@jitl/quickjs-ng-wasmfile-release-sync';
import ts from 'typescript';

async function loadQuickjsCompat() {
  const source = readFileSync(new URL('../src/lib/services/quickjsCompat.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('hoistYieldInForOf fixes QuickJS stack underflow for generator for-of yield loops', async () => {
  const { hoistYieldInForOf } = await loadQuickjsCompat();
  const engine = await newQuickJSWASMModuleFromVariant(variant);

  const source = `
    function* collect(getItems) {
      const out = [];
      for (const item of yield getItems()) {
        out.push(item * 2);
      }
      if (out.length > 0) for (const extra of yield getItems()) out.push(extra + 10);
      return out;
    }
  `;

  const rt = engine.newRuntime();
  const vm = rt.newContext();
  try {
    const rawResult = vm.evalCode(source);
    assert.ok(rawResult.error, 'expected raw generator for-of yield to trigger QuickJS stack underflow');
    const rawError = vm.dump(rawResult.error);
    rawResult.error.dispose();
    assert.match(String(rawError?.message || rawError), /stack underflow/i);

    const rewritten = hoistYieldInForOf(source);
    const fixedResult = vm.evalCode(`
      ${rewritten}
      (() => {
        const gen = collect(() => [1, 2]);
        let step = gen.next();
        step = gen.next(step.value);
        step = gen.next(step.value);
        return JSON.stringify(step.value);
      })()
    `);
    const value = vm.unwrapResult(fixedResult);
    try {
      assert.equal(vm.getString(value), '[2,4,11,12]');
    } finally {
      value.dispose();
    }
  } finally {
    vm.dispose();
    rt.dispose();
  }
});

test('hoistYieldInForOf ignores yield inside strings, comments, regexes, and non-yield loops', async () => {
  const { hoistYieldInForOf } = await loadQuickjsCompat();
  const safe = `
    const s = "for (const x of yield f()) {}";
    // for (const x of yield g()) {}
    const r = /for \\(const x of yield h\\(\\)\\)/;
    for (const x of [1, 2, 3]) { console.log(x); }
  `;
  assert.equal(hoistYieldInForOf(safe), safe);
});
