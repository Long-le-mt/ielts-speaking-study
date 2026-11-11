import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import worker from './index.mjs';

const origin = 'https://study.example.test';

function setup() {
  let attempts = 0;
  const env = {
    AUTH_USERNAME: 'test-learner',
    AUTH_PASSWORD_SHA256: createHash('sha256').update('test-password').digest('hex'),
    SESSION_KEY: 'ab'.repeat(32),
    LOGIN_RATE_LIMIT: {
      async limit() { return { success: ++attempts <= 5 }; },
    },
    ASSETS: {
      async fetch() { return new Response('study interface'); },
    },
  };
  return (path, options) => worker.fetch(new Request(origin + path, options), env);
}

function login(password = 'test-password') {
  return {
    method: 'POST',
    headers: { Origin: origin },
    body: new URLSearchParams({ username: 'test-learner', password }),
  };
}

test('the database and app require a valid signed session', async () => {
  const fetch = setup();
  assert.equal((await fetch('/api/db.json')).status, 401);
  for (const path of ['/', '/index.html', '/app.js']) {
    assert.equal((await fetch(path)).headers.get('Location'), '/login');
  }

  const response = await fetch('/login', login());
  assert.equal(response.status, 303);
  const cookieHeader = response.headers.get('Set-Cookie');
  assert.match(cookieHeader, /; Secure; HttpOnly; SameSite=Lax/);
  const cookie = cookieHeader.split(';')[0];
  const protectedDb = await fetch('/api/db.json', { headers: { Cookie: cookie } });
  assert.equal(protectedDb.status, 200);
  assert.match(protectedDb.headers.get('Cache-Control'), /no-store/);
  assert.equal((await protectedDb.json()).version, 1);
  assert.equal((await fetch('/api/db.json', { headers: { Cookie: cookie + 'x' } })).status, 401);
  assert.equal((await fetch('/', { headers: { Cookie: cookie } })).status, 200);

  const logout = await fetch('/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('cross-site login is rejected and the sixth same-origin attempt is limited', async () => {
  const fetch = setup();
  const crossSite = { ...login(), headers: { Origin: 'https://other.example.test' } };
  assert.equal((await fetch('/login', crossSite)).status, 403);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await fetch('/login', login('wrong-password'))).status, 401);
  }
  const limited = await fetch('/login', login());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
});
