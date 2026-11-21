import {publicHttpUrl, isPublicAddress} from '../src/platform/publicNetworkPolicy.ts';
import {validateRequest, headersOf, redirectHeaders} from '../browser-extension/policy.mjs';
import {cookieHeader, decodeCookieJar, responseCookies, suppliedCookies} from '../src/lib/providers/cookieRules.ts';

const PREFIX = '/api/proxy/';
const COOKIE = '__Host-vega_proxy';
const META_LIMIT = 8 * 1024 * 1024;
const JSON_LIMIT = 32 * 1024 * 1024;
const SESSION_SECONDS = 6 * 60 * 60;
const encoder = new TextEncoder();
const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
const fail = (message, status = 400) => {throw Object.assign(new Error(message), {status});};
const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
async function key(env) {
  if (!env.PROXY_SECRET || env.PROXY_SECRET.length < 32) fail('Proxy is not configured.', 503);
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(env.PROXY_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(data, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await key(env), encoder.encode(JSON.stringify(data)));
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
async function unseal(token, env) {
  try {
    if (typeof token !== 'string' || token.length > 100_000) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error();
    const text = await crypto.subtle.decrypt({name: 'AES-GCM', iv: decode(parts[0])}, await key(env), decode(parts[1]));
    const result = JSON.parse(new TextDecoder().decode(text));
    if (!(result.exp > Date.now())) throw new Error();
    return result;
  } catch {fail('Proxy session expired. Reload Vega and retry.', 401);}
}
function cookie(request) {
  return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
async function session(request, env) {
  const value = await unseal(cookie(request), env);
  if (value.type !== 'session' || value.ip !== request.headers.get('cf-connecting-ip')) fail('Invalid proxy session.', 401);
  return value;
}
async function bounded(response, limit) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) fail('Proxy response exceeds the size limit.', 413);
      chunks.push(value);
    }
  } catch (error) {await reader.cancel().catch(() => {}); throw error;}
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
  return result;
}

/** Preserve normal browser defaults without forwarding Vega cookies or headers. */
export function proxyRequestHeaders(input, request) {
  const headers = new Headers(headersOf(input));
  for (const name of ['user-agent', 'accept-language']) {
    if (!headers.has(name) && request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  if (!headers.has('accept')) headers.set('accept', '*/*');
  return [...headers];
}

/** Public HTTPS destinations only, including every redirect and HLS child. */
export async function checkedDestination(value, origin, fetcher = fetch) {
  const url = publicHttpUrl(value);
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.hostname.replace(/\.$/, '') === new URL(origin).hostname.replace(/\.$/, '')) {
    fail('Proxy destination is blocked: use a public HTTPS server on port 443 outside the Vega app.', 403);
  }
  // Check both address families, including addresses returned through CNAMEs.
  // Workers fetch resolves independently; these checks do not pin its connection.
  let addresses = 0;
  for (const type of ['A', 'AAAA']) {
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(url.hostname)}&type=${type}`, {
      headers: {Accept: 'application/dns-json'}, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) fail('Destination lookup failed.', 502);
    const answer = await response.json();
    if (answer.Status !== 0 || (answer.Answer || []).some(record => [1, 28].includes(record.type) && !isPublicAddress(record.data))) {
      fail('Proxy destination is not public.', 403);
    }
    addresses += (answer.Answer || []).filter(record => [1, 28].includes(record.type)).length;
  }
  if (!addresses) fail('Destination lookup returned no public addresses.', 502);
  return url.href;
}

async function upstream(input, env, origin, signal) {
  let {url, method, headers, body} = input;
  let jar = input.cookies ? decodeCookieJar({version: 2, cookies: input.cookies}) : suppliedCookies([], url, new Headers(headers).get('cookie') || '');
  const cookieUpdates = [];
  for (let hop = 0; hop <= 10; hop++) {
    url = await checkedDestination(url, origin);
    const outgoing = new Headers(headers);
    outgoing.delete('cookie');
    const cookies = cookieHeader(jar, url);
    if (cookies) outgoing.set('cookie', cookies);
    // WAF/app cookies and Cloudflare ingress headers are never forwarded.
    const response = await fetch(url, {method, headers: outgoing, body: body?.length ? Uint8Array.from(body) : undefined,
      redirect: 'manual', signal, cache: 'no-store'});
    const setCookies = response.headers.getSetCookie();
    jar = responseCookies(jar, url, setCookies);
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location || input.redirect === 'manual') {
      return {response, url, jar, cookieUpdates};
    }
    await response.body?.cancel();
    if (input.redirect === 'error') fail('Redirects are disabled for this request.');
    if (setCookies.length) cookieUpdates.push({url, headers: setCookies});
    const next = new URL(location, url).href;
    headers = redirectHeaders(headers, url, next);
    if (response.status === 303 && method !== 'HEAD' || [301, 302].includes(response.status) && method === 'POST') {
      method = 'GET'; body = undefined;
      headers = headers.filter(([name]) => !['content-type', 'content-encoding'].includes(name.toLowerCase()));
    }
    url = next;
  }
  fail('Too many provider redirects.', 502);
}

async function mediaUrl(data, owner, env) {
  return `${PREFIX}media?token=${await seal({...data, type: 'media', sid: owner.sid, exp: owner.exp}, env)}`;
}
export async function rewritePlaylist(text, rewrite) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('#EXTM3U')) fail('Invalid HLS playlist.', 502);
  // Preserve quoting and all non-URI tags. Includes keys, maps, audio, subtitles,
  // variant playlists, parts and preload hints.
  const lines = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.trim() && !line.trimStart().startsWith('#')) {lines.push(await rewrite(line.trim())); continue;}
    let offset = 0, result = '';
    for (const match of line.matchAll(/\bURI="([^"]*)"/g)) {
      result += line.slice(offset, match.index) + `URI="${await rewrite(match[1])}"`;
      offset = match.index + match[0].length;
    }
    lines.push(result + line.slice(offset));
  }
  return lines.join('\n');
}

async function serveMedia(request, env, owner) {
  const token = await unseal(new URL(request.url).searchParams.get('token'), env);
  if (token.type !== 'media' || token.sid !== owner.sid) fail('Invalid media session.', 403);
  const headers = new Headers(token.headers);
  for (const name of ['range', 'if-range']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  const {response, url, jar} = await upstream({url: token.url, method: request.method, headers: [...headers], cookies: token.cookies, redirect: 'follow'}, env, new URL(request.url).origin, request.signal);
  const outgoing = new Headers({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"});
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    if (response.headers.has(name)) outgoing.set(name, response.headers.get(name));
  }
  const playlist = token.hls || /mpegurl/i.test(response.headers.get('content-type') || '') || /\.m3u8(?:[?#]|$)/i.test(url);
  if (playlist && response.ok && request.method !== 'HEAD') {
    const text = new TextDecoder().decode(await bounded(response, META_LIMIT));
    const rewritten = await rewritePlaylist(text, async child => {
      const next = new URL(child, url).href;
      await checkedDestination(next, new URL(request.url).origin);
      return new URL(await mediaUrl({url: next, headers: redirectHeaders(token.headers, token.url, next), cookies: jar}, owner, env), request.url).href;
    });
    outgoing.set('content-type', 'application/vnd.apple.mpegurl');
    outgoing.delete('content-length'); outgoing.delete('content-range'); outgoing.delete('etag');
    return new Response(rewritten, {status: 200, headers: outgoing});
  }
  // Stream bytes without buffering a movie in Worker memory. Cap each transfer.
  let size = 0;
  const stream = response.body?.pipeThrough(new TransformStream({transform(chunk, controller) {
    size += chunk.byteLength;
    if (size > 2 * 1024 ** 3) {controller.error(new Error('Proxy transfer limit exceeded.')); return;}
    controller.enqueue(chunk);
  }}));
  return new Response(request.method === 'HEAD' ? null : stream, {status: response.status, headers: outgoing});
}

export async function handleProxy(request, env) {
  try {
    const url = new URL(request.url), action = url.pathname.slice(PREFIX.length);
    if (!['session', 'request', 'prepare', 'media'].includes(action)) return json({error: 'Not found.'}, 404);
    if (request.headers.get('sec-fetch-site') === 'cross-site') fail('Cross-site proxy access is blocked.', 403);
    if (action === 'media' ? !['GET', 'HEAD'].includes(request.method) : request.method !== 'POST') fail('Method not allowed.', 405);
    if (action !== 'media' && (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json'))) fail('Same-origin JSON requests required.', 403);
    if (!env.PROXY_RATE_LIMITER) fail('Proxy rate limiting is not configured.', 503);
    const rate = await env.PROXY_RATE_LIMITER.limit({key: request.headers.get('cf-connecting-ip') || 'unknown'});
    if (!rate.success) return json({error: 'Proxy request limit reached. Try again shortly.'}, 429);
    await key(env);
    if (action === 'session') {
      try {await session(request, env); return json({ok: true});} catch {}
      const value = await seal({type: 'session', sid: crypto.randomUUID(), ip: request.headers.get('cf-connecting-ip'), exp: Date.now() + SESSION_SECONDS * 1000}, env);
      const response = json({ok: true});
      response.headers.set('set-cookie', `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
      return response;
    }
    const owner = await session(request, env);
    if (action === 'media') return await serveMedia(request, env, owner);
    const body = JSON.parse(new TextDecoder().decode(await bounded(request, JSON_LIMIT)));
    if (action === 'prepare') {
      const target = await checkedDestination(body.url, url.origin);
      const headers = proxyRequestHeaders(body.headers, request);
      return json({url: await mediaUrl({url: target, headers, hls: /hls|m3u8|mpegurl/i.test(body.format || '') || /\.m3u8(?:[?#]|$)/i.test(target)}, owner, env)});
    }
    const input = validateRequest(body);
    input.headers = proxyRequestHeaders(input.headers, request);
    const {response, url: finalUrl, cookieUpdates} = await upstream(input, env, url.origin, AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]));
    return json({url: finalUrl, status: response.status, statusText: response.statusText, headers: [...response.headers].filter(([name]) => name !== 'set-cookie').concat(response.headers.getSetCookie().map(value => ['set-cookie', value])), cookieUpdates,
      body: input.method === 'HEAD' ? [] : Array.from(await bounded(response, META_LIMIT))});
  } catch (error) {
    return json({error: error.status ? error.message : 'Proxy request failed. The provider may require the Vega extension.'}, error.status || 502);
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith(PREFIX)) return handleProxy(request, env);
    return env.ASSETS.fetch(request);
  },
};
