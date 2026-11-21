import wasmUrl from '@jitl/quickjs-ng-wasmfile-release-sync/wasm?url';

// Share compiled, immutable engine code. Each invocation still instantiates
// its own WASM memory and QuickJS runtime inside a fresh worker.
let compiledEngine: Promise<WebAssembly.Module> | undefined;

function compileEngine(): Promise<WebAssembly.Module> {
  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Provider engine initialization timed out')), 30_000);
    try {
      const response = await fetch(wasmUrl, {signal: controller.signal});
      if (!response.ok) throw new Error(`Provider engine could not load (${response.status})`);
      if (typeof WebAssembly.compileStreaming === 'function') {
        try { return await WebAssembly.compileStreaming(response.clone()); }
        catch { /* Custom app protocols may not supply application/wasm. */ }
      }
      return await WebAssembly.compile(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  })();
  compiledEngine = pending;
  void pending.catch(() => { if (compiledEngine === pending) compiledEngine = undefined; });
  return pending;
}

export function getProviderEngine(signal?: AbortSignal): Promise<WebAssembly.Module> {
  signal?.throwIfAborted();
  const pending = compiledEngine ?? compileEngine();
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, {once: true});
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
