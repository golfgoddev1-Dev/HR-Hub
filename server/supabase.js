import { createClient } from '@supabase/supabase-js'
import { getRequiredEnv } from './config.js'

let client

export function getSupabase() {
  if (!client) {
    client = createClient(
      getRequiredEnv('SUPABASE_URL'),
      getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  }
  return client
}
