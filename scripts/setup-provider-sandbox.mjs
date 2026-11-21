import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile} from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
// Bundles the SDK only. No content provider or provider source is included.
await build({root, configFile:false, publicDir:false, logLevel:'warn', build:{
  target:'es2022', outDir:'src/lib/services/generated', emptyOutDir:false, minify:true,
  lib:{entry:fileURLToPath(new URL('../src/lib/services/providerSdk.ts', import.meta.url)), name:'VegaProviderSdk', formats:['iife'], fileName:() => 'providerSdk.js'},
}});
const licenses = await Promise.all(['quickjs-emscripten','quickjs-emscripten-core','@jitl/quickjs-ng-wasmfile-release-sync','core-js-pure','ipaddr.js'].map(async name => `${name}\n${await readFile(new URL(`../node_modules/${name}/LICENSE`,import.meta.url),'utf8')}`));
await writeFile(new URL('../public/vega-provider-runtime-notices.txt',import.meta.url),licenses.join('\n\n'));
