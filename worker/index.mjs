import { timingSafeEqual } from 'node:crypto';
import database from '../data/db.json' with { type: 'json' };
import { loginPage } from './login.mjs';

const encoder = new TextEncoder();
const cookieName = '__Host-ielts_session';
const cookieFlags = 'Path=/; Secure; HttpOnly; SameSite=Lax';
const sessionSeconds = 12 * 60 * 60;
const maxFormBytes = 4096;
const hex256 = /^[a-f0-9]{64}$/i;
const databaseJson = JSON.stringify(database);
const appPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function withPrivateHeaders(response, policy = appPolicy) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Security-Policy', policy);
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, headers });
}

function redirect(path, cookie) {
  const headers = new Headers({ Location: path });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function configured(env) {
  return typeof env.AUTH_USERNAME === 'string' && env.AUTH_USERNAME.length > 0 &&
    typeof env.AUTH_PASSWORD_SHA256 === 'string' && hex256.test(env.AUTH_PASSWORD_SHA256) &&
    typeof env.SESSION_KEY === 'string' && hex256.test(env.SESSION_KEY);
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

async function credentialsMatch(env, username, password) {
  const [submittedUser, expectedUser, submittedPassword] = await Promise.all([
    digest(username), digest(env.AUTH_USERNAME), digest(password),
  ]);
  const usernameMatches = timingSafeEqual(submittedUser, expectedUser);
  const passwordMatches = timingSafeEqual(submittedPassword, hexBytes(env.AUTH_PASSWORD_SHA256));
  return usernameMatches && passwordMatches;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
}

function sessionKey(env) {
  return crypto.subtle.importKey('raw', hexBytes(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function signedSessionData(env, payload) {
  // Changing either credential invalidates previously issued sessions.
  return encoder.encode(JSON.stringify([cookieName, env.AUTH_USERNAME, env.AUTH_PASSWORD_SHA256, payload]));
}

async function makeSessionCookie(env) {
  const expiry = Math.floor(Date.now() / 1000) + sessionSeconds;
  const payload = `${expiry}.${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env), signedSessionData(env, payload));
  return `${cookieName}=${payload}.${base64url(new Uint8Array(signature))}; Max-Age=${sessionSeconds}; ${cookieFlags}`;
}

async function isAuthenticated(request, env) {
  const cookie = request.headers.get('Cookie') ?? '';
  const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  const token = value?.slice(cookieName.length + 1) ?? '';
  const parts = /^(\d{1,12})\.([\w-]{22})\.([\w-]{43})$/.exec(token);
  if (!parts || Number(parts[1]) <= Math.floor(Date.now() / 1000)) return false;

  const signature = fromBase64url(parts[3]);
  if (base64url(signature) !== parts[3]) return false;
  const payload = `${parts[1]}.${parts[2]}`;
  return crypto.subtle.verify('HMAC', await sessionKey(env), signature, signedSessionData(env, payload));
}

async function readLoginForm(request) {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded' || !request.body) return null;
  if (Number(request.headers.get('Content-Length')) > maxFormBytes) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let form = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxFormBytes) return null;
      form += decoder.decode(value, { stream: true });
    }
    return new URLSearchParams(form + decoder.decode());
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function sameOrigin(request, url) {
  return request.headers.get('Origin') === url.origin;
}

function methodNotAllowed(allow) {
  return new Response('Method not allowed', { status: 405, headers: { Allow: allow } });
}

async function login(request, env, url) {
  if (request.method === 'GET') return loginPage();
  if (request.method !== 'POST') return methodNotAllowed('GET, POST');
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  if (!env.LOGIN_RATE_LIMIT) return new Response('Login unavailable', { status: 503 });

  // Cloudflare supplies this header. Local development shares one fallback key.
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'local';
  const { success } = await env.LOGIN_RATE_LIMIT.limit({ key: clientIp });
  if (!success) return loginPage('Quá nhiều lần thử. Vui lòng thử lại sau một phút.', 429, { 'Retry-After': '60' });

  const fields = await readLoginForm(request);
  const username = fields?.get('username') ?? '';
  const password = fields?.get('password') ?? '';
  if (!(await credentialsMatch(env, username, password))) {
    return loginPage('Tên đăng nhập hoặc mật khẩu chưa đúng.', 401);
  }
  return redirect('/', await makeSessionCookie(env));
}

async function handleRequest(request, env, url) {
  if (!configured(env)) return new Response('Service unavailable', { status: 503 });
  if (url.pathname === '/login') return login(request, env, url);
  if (url.pathname === '/logout') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
    return redirect('/login', `${cookieName}=; Max-Age=0; ${cookieFlags}`);
  }

  const isApi = url.pathname.startsWith('/api/');
  if (!(await isAuthenticated(request, env))) {
    return isApi ? Response.json({ error: 'Authentication required' }, { status: 401 }) : redirect('/login');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
  if (url.pathname === '/api/db.json') {
    return new Response(request.method === 'HEAD' ? null : databaseJson, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (isApi) return new Response('Not found', { status: 404 });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await handleRequest(request, env, url);
    const policy = url.pathname === '/login'
      ? "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      : appPolicy;
    return withPrivateHeaders(response, policy);
  },
};
