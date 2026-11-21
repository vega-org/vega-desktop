import test, {beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {hostUrl, mediaUrl, networkUrl, nativeUrl} from './helpers/platform-modules.mjs';

const {getPlatformHost} = await import(hostUrl);
const {platformFetch, platformAxiosAdapter, providerFetch} = await import(networkUrl);
const {prepareMediaSource, releaseMediaSource} = await import(mediaUrl);
const native = await import(nativeUrl);
const originalFetch = globalThis.fetch;
const capabilities = {restrictedHeaders: true, isolatedCookies: true, publicDestinationChecks:true, manualRedirects: true, mediaDelivery: false};
const reply = (url, text = 'ok', headers = []) => ({url, status: 200, headers, body: [...new TextEncoder().encode(text)]});

beforeEach(() => {
  globalThis.window = {};
  const data = new Map();
  globalThis.localStorage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)};
  native.calls.length = 0;
});
afterEach(() => {globalThis.fetch = originalFetch; delete globalThis.window; delete globalThis.localStorage;});

test('public browser fetch and Axios work without a host or extension', async () => {
  let reads = 0;
  globalThis.fetch = async request => {
    reads++; assert.equal(request.credentials, 'omit');
    assert.equal(request.url, 'https://public.example/data');
    return new Response('{"public":true}', {headers: {'Content-Type': 'application/json'}});
  };
  assert.equal(getPlatformHost(), undefined);
  assert.deepEqual(await (await platformFetch('https://public.example/data')).json(), {public: true});
  assert.deepEqual((await axios.get('https://public.example/data', {adapter: platformAxiosAdapter})).data, {public: true});
  assert.equal(reads, 2); assert.deepEqual(native.calls, []);
});

test('opting into the proxy routes provider HTTP through same-origin endpoints while an extension takes precedence', async () => {
  localStorage.setItem('vega_web_proxy_enabled', 'true');
  assert.equal(getPlatformHost().kind, 'hosted-proxy');
  const paths = [];
  globalThis.fetch = async (path, init) => {
    paths.push(path);
    assert.equal(init.credentials, 'same-origin');
    if (path.endsWith('/session')) return Response.json({ok: true});
    const input = JSON.parse(init.body);
    assert.equal(input.scope, 'source-a');
    assert.equal(new Headers(input.headers).get('referer'), 'https://provider.example/');
    return Response.json(reply(input.url, 'proxied'));
  };
  assert.equal(await (await providerFetch('source-a', 'https://provider.example/data', {headers: {Referer: 'https://provider.example/'}})).text(), 'proxied');
  assert.deepEqual(paths, ['/api/proxy/session', '/api/proxy/request']);
  window.vegaPlatformHost = {version: 1, kind: 'browser-extension', capabilities, request: async input => reply(input.url, 'extension')};
  assert.equal(getPlatformHost().kind, 'browser-extension');
  assert.equal(await (await providerFetch('source-a', 'https://provider.example/data')).text(), 'extension');
  assert.equal(paths.length, 2);
});

test('installed extension without website permission never falls back to hosted proxy', async () => {
  localStorage.setItem('vega_web_proxy_enabled', 'true');
  window.__vegaBrowserBridge = true;
  assert.equal(getPlatformHost(), undefined);
  globalThis.fetch = () => {throw new Error('Should not fall back to proxy or browser fetch');};
  await assert.rejects(
    providerFetch('source-a', 'https://provider.example/data'),
    {code: 'HOST_REQUIRED', message: /Allow all websites/},
  );
});

test('browser extension falls back to hosted proxy media delivery for live HLS streams', async () => {
  window.__vegaBrowserBridge = true;
  window.vegaPlatformHost = {
    version: 1,
    kind: 'browser-extension',
    capabilities: {...capabilities, mediaDelivery: true},
    prepareMediaSource: async () => {
      throw new Error('Live HLS needs a streaming transport; this extension currently supports on-demand HLS.');
    },
  };
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    if (path.endsWith('/session')) return Response.json({ok: true});
    return Response.json({url: '/api/proxy/media?token=live-hls'});
  };
  const prepared = await prepareMediaSource({id: 'live-1', source: 'https://live.example/channel.m3u8', format: 'hls', headers: {Referer: 'https://live.example/'}});
  assert.equal(prepared.source, '/api/proxy/media?token=live-hls');
  assert.equal(prepared.headers, undefined);
  assert.deepEqual(paths, ['/api/proxy/session', '/api/proxy/prepare']);
});

test('a WAF challenge produces an actionable proxy verification error', async () => {
  localStorage.setItem('vega_web_proxy_enabled', 'true');
  globalThis.fetch = async () => new Response('<html>Challenge</html>', {status: 403, headers: {'cf-mitigated': 'challenge', 'content-type': 'text/html'}});
  await assert.rejects(providerFetch('source-a', 'https://provider.example/data'), /Reload Vega to complete verification/);
});

test('browser restricted headers fail explicitly instead of being silently dropped', async () => {
  globalThis.fetch = () => {throw new Error('Should not reach fetch');};
  for (const name of ['Cookie', 'Referer', 'User-Agent', 'Origin', 'Sec-Fetch-Site']) {
    await assert.rejects(platformFetch('https://source.example/', {headers: {[name]: 'value'}}), {code: 'HOST_REQUIRED'});
  }
});

test('old hosts cannot silently handle provider traffic without destination checks', async () => {
  const legacy={...capabilities}; delete legacy.publicDestinationChecks;
  let called=false;
  window.vegaPlatformHost={version:1,kind:'browser-extension',capabilities:legacy,request:async()=>{called=true;return reply('https://provider.example/');}};
  await assert.rejects(providerFetch('source-a','https://provider.example/'), /Update the Vega extension/);
  assert.equal(called,false);
});

test('direct browser provider HTTP blocks private literals and unchecked redirects', async () => {
  globalThis.fetch=async request=>{assert.equal(request.redirect,'manual');return {type:'opaqueredirect'};};
  await assert.rejects(providerFetch('source-a','http://127.0.0.1/private'), /blocked/);
  await assert.rejects(providerFetch('source-a','https://provider.example/'), {code:'HOST_REQUIRED'});
});

test('Axios selects the injected host fetch instead of bypassing platform networking', async () => {
  globalThis.fetch = () => {throw new Error('Axios bypassed the host');};
  let seen;
  window.vegaPlatformHost = {version: 1, kind: 'webos', capabilities, request: async request => {seen = request; return reply(request.url, '{"host":true}', [['Content-Type', 'application/json']]);}};
  const response = await axios.get('https://source.example/', {adapter: platformAxiosAdapter, headers: {Cookie: 'manual=yes', Referer: 'https://source.example/'}});
  assert.deepEqual(response.data, {host: true});
  assert.equal(new Headers(seen.headers).get('cookie'), 'manual=yes');
});

test('webOS, Amazon Vega and extension hosts use the same binary-safe HTTP contract', async () => {
  for (const kind of ['webos', 'amazon-vega', 'browser-extension']) {
    let seen;
    window.vegaPlatformHost = {version: 1, kind, capabilities, request: async request => {
      seen = request; return {...reply(request.url), body: [0, 128, 255]};
    }};
    const response = await platformFetch('https://source.example/api', {method: 'POST', headers: {Referer: 'https://source.example/'}, body: Uint8Array.from([0, 255]), redirect: 'manual'});
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 128, 255]);
    assert.deepEqual(seen.body, [0, 255]); assert.equal(seen.credentials, 'omit');
    assert.equal(seen.redirect, 'manual'); assert.ok(seen.headers.some(([key]) => key === 'referer'));
  }
  assert.deepEqual(native.calls, []);
});

test('host cookie responses remain isolated by provider author', async () => {
  const requests = [];
  window.vegaPlatformHost = {version: 1, kind: 'webos', capabilities, request: async request => {
    requests.push(request);
    return reply(request.url, 'ok', requests.length === 1 ? [['Set-Cookie', 'session=alpha; Path=/']] : []);
  }};
  await providerFetch('source-a', 'https://source.example/login');
  await providerFetch('source-a', 'https://source.example/episodes');
  await providerFetch('source-b', 'https://source.example/episodes');
  assert.equal(new Headers(requests[1].headers).get('cookie'), 'session=alpha');
  assert.equal(new Headers(requests[2].headers).get('cookie'), null);
  assert.deepEqual(requests.map(request => request.scope), ['source-a', 'source-a', 'source-b']);
});

test('redirect cookies persist against their response URL and only their source author', async () => {
  const requests = [];
  window.vegaPlatformHost = {version: 1, kind: 'webos', capabilities, request: async request => {
    requests.push(request);
    return requests.length === 1 ? {...reply('https://destination.example/final'), cookieUpdates: [{url: 'https://origin.example/auth/start', headers: ['redirect=secret; Path=/auth; Secure']}]} : reply(request.url);
  }};
  await providerFetch('source-a', 'https://origin.example/auth/start');
  await providerFetch('source-a', 'https://origin.example/auth/data');
  await providerFetch('source-a', 'https://destination.example/auth/data');
  await providerFetch('source-b', 'https://origin.example/auth/data');
  assert.equal(new Headers(requests[1].headers).get('cookie'), 'redirect=secret');
  assert.equal(new Headers(requests[2].headers).get('cookie'), null);
  assert.equal(new Headers(requests[3].headers).get('cookie'), null);
  assert.equal(requests[1].cookies[0].path, '/auth'); assert.equal(requests[1].cookies[0].secure, true);
});

test('invalid redirect cookie metadata is rejected before updating storage', async () => {
  window.vegaPlatformHost = {version: 1, kind: 'webos', capabilities, request: async request => ({...reply(request.url), cookieUpdates: [{url: 'file:///private', headers: ['bad=1']}]})};
  await assert.rejects(providerFetch('source-a', 'https://origin.example/'), {code: 'INVALID_HOST_RESPONSE'});
  assert.equal(localStorage.getItem('vega_provider_cookies:source-a'), null);
});

test('hosts must actually support isolated cookies and manual redirects', async () => {
  window.vegaPlatformHost = {version: 1, kind: 'amazon-vega', capabilities: {...capabilities, isolatedCookies: false, manualRedirects: false}, request: () => {throw new Error('Should not be called');}};
  await assert.rejects(providerFetch('source-a', 'https://source.example/'), {code: 'COOKIE_ISOLATION_REQUIRED'});
  await assert.rejects(platformFetch('https://source.example/', {redirect: 'manual'}), {code: 'HOST_REQUIRED'});
});

test('aborted host requests reject even if the host never settles', async () => {
  const controller = new AbortController(); let hostSignal;
  let entered; const started = new Promise(resolve => {entered = resolve;});
  window.vegaPlatformHost = {version: 1, kind: 'amazon-vega', capabilities, request: (_request, signal) => {hostSignal = signal; entered(); return new Promise(() => {});}};
  const pending = platformFetch('https://source.example/', {signal: controller.signal});
  await started;
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'}); assert.equal(hostSignal.aborted, true);
  await assert.rejects(platformFetch('https://source.example/', {signal: controller.signal}), {name: 'AbortError'});
});

test('startup waits for an injected host rather than sending an early browser request', async () => {
  globalThis.fetch = () => {throw new Error('Startup bypassed the injected host');};
  window.vegaPlatformHostReady = Promise.resolve().then(() => {
    window.vegaPlatformHost = {version: 1, kind: 'browser-extension', capabilities, request: async input => reply(input.url, 'ready')};
  });
  assert.equal(await (await platformFetch('https://source.example/')).text(), 'ready');
});

test('startup host discovery can be canceled before any HTTP request starts', async () => {
  window.vegaPlatformHostReady = new Promise(() => {});
  globalThis.fetch = () => {throw new Error('Canceled startup sent a request');};
  const controller = new AbortController();
  const pending = platformFetch('https://source.example/', {signal: controller.signal});
  controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
});

test('a prepared source releases its original host once after host replacement', async () => {
  const released = [];
  window.vegaPlatformHost = {version: 1, kind: 'browser-extension', capabilities: {...capabilities, mediaDelivery: true},
    prepareMediaSource: async source => ({...source, id: 'lease-1'}), releaseMediaSource: async id => {released.push(id);}};
  const source = await prepareMediaSource({id: 'movie', source: 'https://media.example/movie.mp4'});
  delete window.vegaPlatformHost;
  await releaseMediaSource(source); await releaseMediaSource(source);
  assert.deepEqual(released, ['lease-1']);
});

test('invalid hosts and invalid HTTP results cannot silently fall back to browser fetch', async () => {
  window.vegaPlatformHost = {version: 2, kind: 'webos', capabilities};
  await assert.rejects(platformFetch('https://source.example/'), /Unsupported Vega platform/);
  window.vegaPlatformHost = {version: 1, kind: 'webos', capabilities, request: async () => ({status: 0, headers: [], body: []})};
  await assert.rejects(platformFetch('https://source.example/'), {code: 'INVALID_HOST_RESPONSE'});
});

test('protected media requires media preparation, not only a provider HTTP bridge', async () => {
  const source = {id: 'episode', source: 'https://video.example/master.m3u8', headers: {Referer: 'https://source.example/'}, startPosition: 40};
  window.vegaPlatformHost = {version: 1, kind: 'webos', capabilities, request: async request => reply(request.url)};
  await assert.rejects(prepareMediaSource(source), {code: 'HOST_REQUIRED'});
  window.vegaPlatformHost.capabilities = {...capabilities, mediaDelivery: true};
  window.vegaPlatformHost.prepareMediaSource = async input => ({...input, source: 'http://127.0.0.1:8000/session/master.m3u8', headers: undefined});
  const delivered = await prepareMediaSource(source);
  assert.equal(delivered.startPosition, 40); assert.equal(delivered.headers, undefined);
  assert.equal(source.source, 'https://video.example/master.m3u8'); assert.equal(source.headers.Referer, 'https://source.example/');
});

test('direct public and browser-selected media need no extension; native paths do', async () => {
  const publicSource = {id: 'one', source: 'https://video.example/movie.mp4'};
  assert.deepEqual(await prepareMediaSource(publicSource), publicSource);
  const file = {id: 'file', source: new File(['video'], 'movie.mp4')};
  assert.equal((await prepareMediaSource(file)).source, file.source);
  const localSubtitle = await prepareMediaSource({id: 'sub', source: 'blob:https://vega.example/subtitle', headers: {Cookie: 'remote=secret'}});
  assert.equal(localSubtitle.headers, undefined);
  await assert.rejects(prepareMediaSource({id: 'local', source: 'C:\\videos\\movie.mkv'}), {code: 'HOST_REQUIRED'});
});

test('Tauri retains its existing provider/Axios implementation and loopback media paths', async () => {
  window.__TAURI_INTERNALS__ = {};
  assert.equal(await (await providerFetch('source-a', 'https://source.example/')).text(), 'native provider');
  assert.equal((await axios.get('https://source.example/', {adapter: platformAxiosAdapter})).data, 'native');
  const headers = {Referer: 'https://source.example/'};
  const hls = await prepareMediaSource({id: 'hls', source: 'https://video.example/master', format: 'hls', headers});
  const url = new URL(hls.source);
  assert.equal(url.pathname, '/playlist.m3u8'); assert.equal(url.searchParams.get('headers'), JSON.stringify(headers));
  assert.equal(hls.headers, undefined);
  const local = await prepareMediaSource({id: 'local', source: 'local://user-token'});
  assert.equal(local.source, 'http://127.0.0.1:9911/local/user-token/media');
  const disk = await prepareMediaSource({id: 'disk', source: 'C:\\videos\\movie.mkv'});
  assert.equal(new URL(disk.source).searchParams.get('path'), 'C:\\videos\\movie.mkv');
  assert.deepEqual(native.calls.slice(0, 2), [['provider', 'source-a'], 'axios']);
});
