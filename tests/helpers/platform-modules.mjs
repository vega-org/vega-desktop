import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

export const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export async function sourceModule(relative, imports = {}) {
  const source = await readFile(new URL(relative, new URL('../../src/', import.meta.url)), 'utf8');
  let js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
  for (const [name, value] of Object.entries(imports)) {
    js = js.replaceAll(`'${name}'`, JSON.stringify(value)).replaceAll(`"${name}"`, JSON.stringify(value));
  }
  return moduleUrl(js);
}

const require = createRequire(import.meta.url);
export const nativeUrl = moduleUrl(`
  export const calls=[];
  export async function invoke(command){calls.push(command);if(command!=='get_stream_proxy_port')throw new Error(command);return 9911;}
  export async function tauriAxiosAdapter(config){calls.push('axios');return {data:'native',status:200,statusText:'OK',headers:{},config};}
  export async function providerFetch(author,url){calls.push(['provider',author]);return new Response('native provider');}
  export async function fetch(input,init){calls.push('http');return globalThis.fetch(input,init);}
`);
export const proxyHostUrl = await sourceModule('platform/proxyHost.ts');
export const hostUrl = await sourceModule('platform/host.ts', {'./proxyHost': proxyHostUrl});
export const publicNetworkUrl = await sourceModule('platform/publicNetworkPolicy.ts', {'ipaddr.js':pathToFileURL(require.resolve('ipaddr.js')).href});
export const scopeUrl = await sourceModule('lib/providers/providerScope.ts', {
  '../storage/extensionStorage': moduleUrl('export const extensionStorage={getInstalledProviders:()=>[]};'),
});
export const cookieRulesUrl = await sourceModule('lib/providers/cookieRules.ts', {tldts: pathToFileURL(require.resolve('tldts')).href});
export const cookieUrl = await sourceModule('lib/providers/providerCookieJar.ts', {'./providerScope': scopeUrl, './cookieRules': cookieRulesUrl});
export const tauriMediaUrl = await sourceModule('platform/tauri/mediaDelivery.ts', {'@tauri-apps/api/core': nativeUrl});
const torrentSourceUrl = moduleUrl(ts.transpileModule(await readFile(new URL(import.meta.resolve('@vega/libmedia-engine/torrent-source')), 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText);
export const mediaUrl = await sourceModule('platform/mediaDelivery.ts', {'@vega/libmedia-engine/torrent-source': torrentSourceUrl, './host': hostUrl, './proxyHost': proxyHostUrl, './tauri/mediaDelivery': tauriMediaUrl});
export const networkUrl = await sourceModule('platform/network.ts', {
  './publicNetworkPolicy':publicNetworkUrl,
  axios: pathToFileURL(path.join(path.dirname(require.resolve('axios/package.json')), 'dist/browser/axios.cjs')).href,
  './host': hostUrl,
  '../lib/providers/providerCookieJar': cookieUrl,
  '../lib/providers/tauriAxiosAdapter': nativeUrl,
  '@tauri-apps/plugin-http': nativeUrl,
});
