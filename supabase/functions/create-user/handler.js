// Admin-only seller account creation. Ported from the old Vercel function
// (api/create-user.js). Runtime-agnostic: index.ts wires it to Deno.serve,
// tests call it directly with a fake Supabase client.
//
// Env (Supabase provides the first three automatically to Edge Functions):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   ALLOWED_ORIGINS - comma-separated browser origins, e.g. https://<project>.pages.dev

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

// Best-effort per-instance rate limit; the admin JWT check is the real control.
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;            // requests per IP per window

export function createHandler({ env, createClient, now = () => Date.now() }) {
  const rateLimitStore = new Map();
  const allowedOrigins = [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...String(env('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean),
  ];

  function checkRateLimit(ip) {
    const t = now();
    if (rateLimitStore.size > 1024) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (t - v.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitStore.delete(k);
      }
    }
    const entry = rateLimitStore.get(ip);
    if (!entry || t - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.set(ip, { count: 1, windowStart: t });
      return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      return { allowed: false, retryAfter: Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - t) / 1000) };
    }
    entry.count++;
    return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
  }

  return async function handler(req) {
    const origin = req.headers.get('origin');
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };
    if (origin && allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    const json = (status, body, extra = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      return json(429, { error: `Too many requests. Try again in ${rl.retryAfter}s.` }, { 'Retry-After': String(rl.retryAfter) });
    }

    const supabaseUrl = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { error: 'Server configuration error' });
    }

    // Verify the caller is an authenticated admin
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return json(401, { error: 'Unauthorized' });

    const callerClient = createClient(supabaseUrl, anonKey);
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !caller) return json(401, { error: 'Invalid token' });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile } = await adminClient.from('profiles').select('role').eq('id', caller.id).single();
    if (callerProfile?.role !== 'admin') return json(403, { error: 'Only admins can create users' });

    // Validate input
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }
    const { email, password, full_name, phone } = body || {};
    if (!email || !password || !full_name) {
      return json(400, { error: 'Email, password, and name are required' });
    }
    if (String(password).length < 6) {
      return json(400, { error: 'Password must be at least 6 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'Invalid email format' });
    }

    // Create user via admin API (service role)
    const { data, error } = await adminClient.auth.admin.createUser({
      email: String(email).toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name, role: 'seller' },
    });
    if (error) return json(400, { error: error.message });

    // Update profile with phone if provided
    if (phone) {
      await adminClient.from('profiles').update({ phone }).eq('id', data.user.id);
    }

    return json(200, { success: true, user_id: data.user.id });
  };
}
