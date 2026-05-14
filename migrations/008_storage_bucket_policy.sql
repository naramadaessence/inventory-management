-- ============================================
-- Migration 008: Tighten product-images storage bucket policies
-- Run this in Supabase SQL Editor.
-- ============================================
--
-- Current state:
--   - Client-side: products.js validates max 5 MB + image MIME types.
--   - Server-side: nothing — a determined attacker bypasses the client and
--     uploads any file type / any size to product-images.
--
-- Fix:
--   Configure bucket-level limits via the storage.buckets table.
--   Supabase enforces these regardless of the upload path.

UPDATE storage.buckets
SET
  file_size_limit = 5242880, -- 5 MB
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif'
  ]
WHERE id = 'product-images';

-- Verify the update.
-- After running, this should return one row matching the constraints above:
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'product-images';

-- Notes:
--   - If 0 rows updated, the bucket doesn't exist yet — create it via the
--     Supabase Dashboard (Storage > New bucket > public + product-images)
--     before re-running.
--   - The `public` flag stays as-is (true) so product images render in the
--     app via direct URL.
--   - If you ever switch to private buckets, drop the public flag and use
--     signed URLs in products.js.
