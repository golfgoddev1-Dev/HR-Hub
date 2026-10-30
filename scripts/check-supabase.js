import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { getSupabase } from '../server/supabase.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true })

const { error } = await getSupabase().from('employees').select('id').limit(1)
if (error) {
  console.log('SUPABASE ERROR', error.code, error.message)
  process.exitCode = 1
} else {
  console.log('SUPABASE OK')
}
