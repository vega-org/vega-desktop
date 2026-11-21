import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {handleProxy, checkedDestination, rewritePlaylist, proxyRequestHeaders} from '../workers/web.mjs';

const originalFetch = globalThis.fetch;
afterEach(() => {globalThis.fetch = originalFetch;});
const origin = 'https://web.vega-app.in';
const env = () => ({PROXY_SECRET: 'test-only-secret-at-least-thirty-two-characters', PROXY_RATE_LIMITER: {limit: async () => ({success: true})}});
const request = (path, body, cookie) => new Request(`${origin}/api/proxy/${path}`, {
  method: 'POST', headers: {'Origin': origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...(cookie ? {Cookie: cookie} : {})}, body: JSON.stringify(body),
});
async function session(environment) {
  const response = await handleProxy(request('session', {}), environment);
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
function dns(url) {
  if (String(url).startsWith('https://cloudflare-dns.com/')) return Response.json({Status: 0, Answer: [{type: String(url).includes('type=AAAA') ? 28 : 1, data: String(url).includes('type=AAAA') ? '2606:4700:4700::1111' : '1.1.1.1'}]});
}
const input = (url, headers = []) => ({url, method: 'GET', headers, redirect: 'follow', credentials: 'omit'});

test('proxy fails closed without configuration, valid session, same origin or rate budget', async () => {
  assert.equal((await handleProxy(request('session', {}), {})).status, 503);
  assert.equal((await handleProxy(request('request', input('https://provider.example')), env())).status, 401);
  const cross = request('session', {}); cross.headers.set('origin', 'https://attacker.example');
  assert.equal((await handleProxy(cross, env())).status, 403);
  assert.equal((await handleProxy(request('session', {}), {...env(), PROXY_RATE_LIMITER: {limit: async () => ({success: false})}})).status, 429);
});

test('browser request defaults survive proxying without leaking app credentials or inventing referrers', () => {
  const browser = new Request(origin, {headers: {
    'User-Agent': 'Browser client', 'Accept-Language': 'en-GB,en;q=0.9',
    Cookie: 'vega=private', Authorization: 'Bearer private', Referer: `${origin}/extensions`,
    Origin: origin, 'CF-Connecting-IP': '203.0.113.9',
  }});
  const defaults = new Headers(proxyRequestHeaders([], browser));
  assert.equal(defaults.get('user-agent'), 'Browser client');
  assert.equal(defaults.get('accept-language'), 'en-GB,en;q=0.9');
  assert.equal(defaults.get('accept'), '*/*');
  for (const name of ['cookie', 'authorization', 'referer', 'origin', 'cf-connecting-ip']) assert.equal(defaults.get(name), null);
  const explicit = new Headers(proxyRequestHeaders([['User-Agent', 'Provider client'], ['Accept-Language', 'ja'], ['Accept', 'application/json'], ['Referer', 'https://provider.example/']], browser));
  assert.equal(explicit.get('user-agent'), 'Provider client');
  assert.equal(explicit.get('accept-language'), 'ja');
  assert.equal(explicit.get('accept'), 'application/json');
  assert.equal(explicit.get('referer'), 'https://provider.example/');
});

test('headerless provider requests and prepared media inherit the actual browser identity', async () => {
  const environment = env(), owner = await session(environment);
  globalThis.fetch = async (url, options) => {
    const lookup = dns(url); if (lookup) return lookup;
    assert.equal(options.headers.get('user-agent'), 'Browser client');
    assert.equal(options.headers.get('accept-language'), 'en');
    assert.equal(options.headers.get('cookie'), null);
    return new Response('ok');
  };
  const metadata = request('request', input('https://provider.example/data'), owner);
  metadata.headers.set('user-agent', 'Browser client'); metadata.headers.set('accept-language', 'en');
  const response = await handleProxy(metadata, environment);
  assert.equal(response.status, 200);
  const prepare = request('prepare', {url: 'https://provider.example/video.mp4'}, owner);
  prepare.headers.set('user-agent', 'Browser client'); prepare.headers.set('accept-language', 'en');
  const prepared = await handleProxy(prepare, environment);
  const {url} = await prepared.json();
  const media = new Request(new URL(url, origin), {headers: {Cookie: owner, 'CF-Connecting-IP': '203.0.113.9'}});
  assert.equal((await handleProxy(media, environment)).status, 200);
});

test('destination checks reject private URLs, insecure schemes, ports, recursion and private DNS', async () => {
  for (const url of ['https://127.0.0.1', 'https://[::1]', 'https://10.0.0.1', 'https://169.254.169.254', 'https://server.local', 'https://localhost', 'http://provider.example', 'ftp://provider.example', 'https://user:password@provider.example', 'https://provider.example:8443', `${origin}/api/proxy/media`, 'https://web.vega-app.in./']) {
    await assert.rejects(checkedDestination(url, origin, () => {throw new Error('Should not resolve');}));
  }
  await assert.rejects(checkedDestination('https://provider.example', origin, async () => Response.json({Status: 0, Answer: [{type: 1, data: '10.0.0.1'}]})), /not public/);
  await assert.rejects(checkedDestination('https://provider.example', origin, async () => Response.json({Status: 0, Answer: [{type: 1, data: '1.1.1.1'}, {type: 28, data: 'fd00::1'}]})), /not public/);
});

test('any public HTTPS domain is accepted without a provider allowlist', async () => {
  for (const host of ['anikototv.to', 'new-provider.example', 'new-video-cdn.example']) {
    assert.equal(await checkedDestination(`https://${host}/media`, origin, dns), `https://${host}/media`);
  }
  await assert.rejects(checkedDestination('https://missing.example', origin, async () => Response.json({Status: 0, Answer: []})), /no public addresses/);
});

test('metadata can redirect to a new public domain without adding configuration', async () => {
  const environment = env(), owner = await session(environment), seen = [];
  globalThis.fetch = async url => {
    const lookup = dns(url); if (lookup) return lookup;
    seen.push(url);
    return seen.length === 1 ? new Response(null, {status: 302, headers: {Location: 'https://new-cdn.example/data'}}) : new Response('ok');
  };
  const response = await handleProxy(request('request', input('https://new-provider.example/start'), owner), environment);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://new-cdn.example/data');
  assert.deepEqual(seen, ['https://new-provider.example/start', 'https://new-cdn.example/data']);
});

test('metadata redirects isolate cookies and never send Vega session cookies upstream', async () => {
  const environment = env(), owner = await session(environment), calls = [];
  globalThis.fetch = async (url, options) => {
    const lookup = dns(url); if (lookup) return lookup;
    calls.push({url, options});
    if (calls.length === 1) return new Response(null, {status: 302, headers: {Location: 'https://cdn.example/data', 'Set-Cookie': 'provider=one; Secure; Path=/'}});
    return new Response('ok', {headers: {'Set-Cookie': 'cdn=two; Secure; Path=/'}});
  };
  const response = await handleProxy(request('request', input('https://provider.example/start', [['Authorization', 'secret'], ['Cookie', 'provider=original']]), owner), environment);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(new TextDecoder().decode(Uint8Array.from(result.body)), 'ok');
  assert.equal(calls[0].options.headers.get('cookie'), 'provider=original');
  assert.equal(calls[1].options.headers.get('cookie'), null);
  assert.equal(new Headers(calls[1].options.headers).get('authorization'), null);
  assert.equal(result.cookieUpdates[0].url, 'https://provider.example/start');
});

test('redirects are checked before fetching a forbidden destination', async () => {
  const environment = env(), owner = await session(environment); let calls = 0;
  globalThis.fetch = async url => dns(url) || (calls++, new Response(null, {status: 302, headers: {Location: 'https://127.0.0.1/private'}}));
  const response = await handleProxy(request('request', input('https://provider.example/start'), owner), environment);
  assert.equal(response.status, 502); assert.equal(calls, 1);
});

test('HLS rewrites variants, keys, maps and subtitle URI attributes', async () => {
  const result = await rewritePlaylist('\n  #EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="sub.m3u8"\nvariant.m3u8\nsegment.ts', async uri => `proxy/${uri}`);
  assert.ok(result.startsWith('#EXTM3U'));
  for (const uri of ['key', 'init.mp4', 'sub.m3u8', 'variant.m3u8', 'segment.ts']) assert.ok(result.includes(`proxy/${uri}`));
});

test('media URLs require their issuing session and preserve byte ranges', async () => {
  const environment = env(), owner = await session(environment), other = await session(environment);
  globalThis.fetch = async (url, options) => {
    const lookup = dns(url); if (lookup) return lookup;
    assert.equal(options.headers.get('range'), 'bytes=2-4');
    assert.equal(options.headers.get('cookie'), null);
    return new Response(new Uint8Array([2, 3, 4]), {status: 206, headers: {'Content-Range': 'bytes 2-4/10', 'Set-Cookie': 'private=upstream'}});
  };
  const prepared = await handleProxy(request('prepare', {url: 'https://cdn.example/video.mp4'}, owner), environment);
  const {url} = await prepared.json();
  const media = cookie => new Request(new URL(url, origin), {headers: {Cookie: cookie, Range: 'bytes=2-4', 'CF-Connecting-IP': '203.0.113.9'}});
  assert.equal((await handleProxy(media(other), environment)).status, 403);
  const response = await handleProxy(media(owner), environment);
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4]);
});

test('HLS delivery resolves child URLs against the final playlist URL and protects keys', async () => {
  const environment = env(), owner = await session(environment);
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const lookup = dns(url); if (lookup) return lookup;
    seen.push(url);
    if (url === 'https://provider.example/start') return new Response(null, {status: 302, headers: {Location: 'https://cdn.example/video/main.m3u8'}});
    if (url.endsWith('main.m3u8')) return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts', {headers: {'Content-Type': 'application/vnd.apple.mpegurl', 'Set-Cookie': 'cdn=private; Secure; Path=/'}});
    assert.equal(options.headers.get('cookie'), 'cdn=private');
    return new Response('key bytes');
  };
  const prepared = await handleProxy(request('prepare', {url: 'https://provider.example/start', format: 'hls', headers: [['Authorization', 'private-value']]}, owner), environment);
  const {url} = await prepared.json();
  assert.ok(!url.includes('private-value'));
  const media = value => new Request(new URL(value, origin), {headers: {Cookie: owner, 'CF-Connecting-IP': '203.0.113.9'}});
  const response = await handleProxy(media(url), environment);
  const playlist = await response.text();
  assert.ok(playlist.startsWith('#EXTM3U'));
  assert.ok(!playlist.includes('https://cdn.example'));
  const keyUrl = /URI="([^"]+)"/.exec(playlist)[1];
  assert.equal(await (await handleProxy(media(keyUrl), environment)).text(), 'key bytes');
  assert.equal(seen.at(-1), 'https://cdn.example/video/key.bin');
  const tampered = new URL(keyUrl); tampered.searchParams.set('token', tampered.searchParams.get('token') + 'x');
  assert.equal((await handleProxy(media(tampered), environment)).status, 401);
});
