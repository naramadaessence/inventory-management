// Supabase Edge Function entry point. Logic lives in handler.js.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './handler.js';

Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key), createClient }));
