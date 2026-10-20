// @vitest-environment node
// Tests for the create-user Supabase Edge Function handler
// (supabase/functions/create-user/handler.js) using a fake Supabase client.

import { describe, it, expect } from 'vitest';
import { createHandler } from '../supabase/functions/create-user/handler.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: 'https://app.pages.dev',
};

function fakeSupabase({ callerRole = 'admin', validToken = 'good-token', createError = null } = {}) {
  const calls = { created: [], profileUpdates: [] };
  const createClient = () => ({
    auth: {
      getUser: async (token) => token === validToken
        ? { data: { user: { id: 'caller-1' } }, error: null }
        : { data: { user: null }, error: { message: 'bad token' } },
      admin: {
        createUser: async (args) => {
          if (createError) return { data: null, error: { message: createError } };
          calls.created.push(args);
          return { data: { user: { id: 'new-user-1' } }, error: null };
        },
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { role: callerRole } }) }) }),
      update: (values) => ({ eq: async (_col, id) => { calls.profileUpdates.push({ id, values }); return { error: null }; } }),
    }),
  });
  return { createClient, calls };
}

function makeHandler(opts = {}, env = ENV) {
  const fake = fakeSupabase(opts);
  return { handler: createHandler({ env: (k) => env[k], createClient: fake.createClient }), calls: fake.calls };
}

function post(body, { token = 'good-token', origin = 'https://app.pages.dev', ip = '1.1.1.1' } = {}) {
  const headers = { 'content-type': 'application/json', origin, 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('https://fn.example/create-user', { method: 'POST', headers, body: JSON.stringify(body) });
}

const VALID = { email: 'New.Seller@Example.com', password: 'secret1', full_name: 'New Seller', phone: '9999999999' };

describe('create-user edge function', () => {
  it('answers CORS preflight for an allowed origin', async () => {
    const { handler } = makeHandler();
    const res = await handler(new Request('https://fn.example/create-user', { method: 'OPTIONS', headers: { origin: 'https://app.pages.dev' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.pages.dev');
  });

  it('does not echo an origin that is not on the allow list', async () => {
    const { handler } = makeHandler();
    const res = await handler(new Request('https://fn.example/create-user', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects non-POST methods', async () => {
    const { handler } = makeHandler();
    const res = await handler(new Request('https://fn.example/create-user', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('rejects a request without an Authorization header', async () => {
    const { handler } = makeHandler();
    const res = await handler(post(VALID, { token: null }));
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const { handler } = makeHandler();
    const res = await handler(post(VALID, { token: 'forged' }));
    expect(res.status).toBe(401);
  });

  it('rejects a caller who is not an admin', async () => {
    const { handler, calls } = makeHandler({ callerRole: 'seller' });
    const res = await handler(post(VALID));
    expect(res.status).toBe(403);
    expect(calls.created).toHaveLength(0);
  });

  it('rejects a short password', async () => {
    const { handler } = makeHandler();
    const res = await handler(post({ ...VALID, password: '123' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 when Supabase env vars are missing', async () => {
    const { handler } = makeHandler({}, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined });
    const res = await handler(post(VALID));
    expect(res.status).toBe(500);
  });

  it('creates a seller account and saves the phone number for an admin caller', async () => {
    const { handler, calls } = makeHandler();
    const res = await handler(post(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, user_id: 'new-user-1' });
    expect(calls.created[0]).toMatchObject({
      email: 'new.seller@example.com', email_confirm: true, user_metadata: { full_name: 'New Seller', role: 'seller' },
    });
    expect(calls.profileUpdates).toEqual([{ id: 'new-user-1', values: { phone: '9999999999' } }]);
  });

  it('passes Supabase auth errors back as 400', async () => {
    const { handler } = makeHandler({ createError: 'User already registered' });
    const res = await handler(post(VALID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('User already registered');
  });

  it('rate-limits a single IP after 5 requests per minute', async () => {
    const { handler } = makeHandler({ callerRole: 'seller' });
    for (let i = 0; i < 5; i++) await handler(post(VALID, { ip: '2.2.2.2' }));
    const res = await handler(post(VALID, { ip: '2.2.2.2' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});
