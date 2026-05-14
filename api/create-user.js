import { createClient } from '@supabase/supabase-js';

// Allowed origins for CORS. Add additional deployment URLs here if needed.
const ALLOWED_ORIGINS = [
  'https://inventory-management-pi-opal.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

// Lightweight in-memory rate limit. Vercel serverless instances are short-lived
// and there can be multiple warm instances at once, so this is best-effort
// defense-in-depth — not the primary security control (the admin JWT check
// below is). For stricter limits use Upstash Redis or Vercel KV.
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;            // requests per IP per window
const _rateLimitStore = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  // Best-effort cleanup so the map doesn't grow unbounded across warm-instance lifetime.
  if (_rateLimitStore.size > 1024) {
    for (const [k, v] of _rateLimitStore.entries()) {
      if (now - v.windowStart > RATE_LIMIT_WINDOW_MS * 2) _rateLimitStore.delete(k);
    }
  }
  const entry = _rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

export default async function handler(req, res) {
  // CORS — pinned to known origins only (defense in depth alongside JWT auth)
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit early — before heavy auth/DB work. Returns 429 if exceeded.
  const ip = clientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: `Too many requests. Try again in ${rl.retryAfter}s.` });
  }
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Verify the caller is an authenticated admin
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const callerClient = createClient(supabaseUrl, anonKey);
  const { data: { user: caller }, error: authError } = await callerClient.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !caller) return res.status(401).json({ error: 'Invalid token' });

  // Check caller is admin
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile } = await adminClient.from('profiles').select('role').eq('id', caller.id).single();
  if (callerProfile?.role !== 'admin') return res.status(403).json({ error: 'Only admins can create users' });

  // Validate input
  const { email, password, full_name, phone } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Create user via admin API (service role)
  const { data, error } = await adminClient.auth.admin.createUser({
    email: email.toLowerCase().trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'seller' }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  // Update profile with phone if provided
  if (phone) {
    await adminClient.from('profiles').update({ phone }).eq('id', data.user.id);
  }

  return res.status(200).json({ success: true, user_id: data.user.id });
}
