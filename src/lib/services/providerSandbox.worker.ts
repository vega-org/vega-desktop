import {newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSRuntime} from 'quickjs-emscripten';
import variant from '@jitl/quickjs-ng-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-ng-wasmfile-release-sync/wasm?url';
import sdk from './generated/providerSdk.js?raw';
import {Crypto} from '../../platform/crypto';

// Trusted transport only. All provider code and SDK objects live in a separate
// WASM heap. No browser objects or JS functions cross that boundary.
let vm: QuickJSContext | undefined;
let runtime: QuickJSRuntime | undefined;
let token = '';
let completed = false;
let totalRequests = 0;
const active = new Set<number>();
let cpuRemaining = 5_000;
let startedAt = 0;
const deadline = Date.now() + 120_000;

function fail(error: unknown) {
  if (completed) return;
  completed = true;
  self.postMessage({type:'result', token, error:error instanceof Error ? error.message : String(error)});
}
function evaluate(code: string) {
  if (!vm || !runtime || completed) return;
  startedAt = Date.now();
  try {
    const result = vm.evalCode(code);
    if (result.error) {const error = vm.dump(result.error); result.error.dispose(); throw new Error(error?.message || 'Provider execution failed');}
    result.value.dispose();
    let jobs = 0;
    while (runtime.hasPendingJob() && !completed) {
      if (++jobs > 10_000) throw new Error('Provider job limit exceeded');
      const pending = runtime.executePendingJobs(32);
      if (pending.error) {const error = vm.dump(pending.error); pending.error.dispose(); throw new Error(error?.message || 'Provider job failed');}
    }
  } finally {cpuRemaining -= Date.now() - startedAt;}
}
function reply(id: number, result?: unknown, error?: string) {
  if (!active.delete(id) || completed) return;
  if (result && typeof result === 'object' && 'data' in result && (result as any).data instanceof ArrayBuffer) result = {...result, data:Array.from(new Uint8Array((result as any).data))};
  const message = JSON.stringify({id, result, error});
  if (message.length > 40 * 1024 * 1024) {fail(new Error('Provider response exceeds serialization limit')); return;}
  try {evaluate(`__providerReply(${message})`);} catch (failure) {fail(failure);}
}
async function request(message: string) {
  let id: number | undefined;
  try {
    if (message.length > 12 * 1024 * 1024) throw new Error('Provider request is too large');
    const parsed = JSON.parse(message); id = parsed.id;
    if (!Number.isSafeInteger(id) || active.has(id!) || active.size >= 16 || ++totalRequests > 256) throw new Error('Provider request limit exceeded');
    active.add(id!);
    if (parsed.operation === '__sleep') {
      const ms = parsed.args?.ms;
      if (!Number.isFinite(ms) || ms < 0 || ms > 30_000) throw new Error('Invalid provider timer');
      setTimeout(() => reply(id!), ms); return;
    }
    if (parsed.operation === '__digest') {
      if (typeof parsed.args?.data !== 'string' || parsed.args.data.length > 2_000_000 || !['SHA-1','SHA-256','SHA-384','SHA-512'].includes(parsed.args?.algorithm)) throw new Error('Invalid provider digest');
      reply(id!, await Crypto.digestStringAsync(parsed.args.algorithm, parsed.args.data)); return;
    }
    if (!['fetch','getBaseUrl','openWebView','kvGet','kvSet','kvDelete','kvKeys','kvClear'].includes(parsed.operation)) throw new Error('Unsupported provider operation');
    self.postMessage({type:'rpc', token, id, operation:parsed.operation, args:parsed.args});
  } catch (error) {if (id !== undefined && active.has(id)) reply(id, undefined, error instanceof Error ? error.message : String(error)); else fail(error);}
}
self.addEventListener('message', async event => {
  const message = event.data;
  if (message?.type === 'rpc-result' && message.token === token) {reply(message.id, message.result, message.error); return;}
  if (message?.type !== 'invoke' || token) return;
  token = message.token;
  try {
    if (typeof message.moduleCode !== 'string' || message.moduleCode.length > 2_000_000) throw new Error('Invalid provider module');
    const engine = await newQuickJSWASMModuleFromVariant(newVariant(variant,
      message.engineModule instanceof WebAssembly.Module
        ? {wasmModule: message.engineModule} : {wasmLocation: wasmUrl}));
    runtime = engine.newRuntime();
    runtime.setMemoryLimit(128 * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    runtime.setInterruptHandler(() => Date.now() >= deadline || Date.now() - startedAt >= cpuRemaining);
    vm = runtime.newContext(); // No loader: imports cannot access host or remote modules.
    const send = vm.newFunction('__hostSend', value => {const text = vm!.getString(value); queueMicrotask(() => {if (!completed) void request(text);});});
    vm.setProp(vm.global, '__hostSend', send); send.dispose();
    const finish = vm.newFunction('__hostFinish', value => {
      if (completed) return;
      const text = vm!.getString(value);
      if (text.length > 8 * 1024 * 1024) {fail(new Error('Provider result is too large')); return;}
      const result = JSON.parse(text); completed = true;
      self.postMessage({type:'result', token, result:result.result, state:result.state, error:result.error});
    });
    vm.setProp(vm.global, '__hostFinish', finish); finish.dispose();
    const random = Array.from(crypto.getRandomValues(new Uint8Array(4096)));
    evaluate(`const __randomBytes=${JSON.stringify(random)};\n${sdk}\n__providerStart(${JSON.stringify(message)})`);
  } catch (error) {fail(error);}
});
