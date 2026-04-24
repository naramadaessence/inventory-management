import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
