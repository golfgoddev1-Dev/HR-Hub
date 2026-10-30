import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { getSupabase } from '../server/supabase.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true })

function printError(error) {
  console.log('MEETING TYPES ERROR')
  console.log('code:', error?.code)
  console.log('message:', error?.message)
  console.log('details:', error?.details)
  console.log('hint:', error?.hint)
}

let response
try {
  response = await getSupabase()
    .from('meeting_types')
    .select('id, code, name, qr_token, weekday, default_open_time, default_cutoff_time')
    .limit(1)
} catch (error) {
  printError(error)
  process.exit(1)
}

const { data, error } = response
if (error) {
  printError(error)
  process.exit(1)
}

console.log('MEETING TYPES OK')
console.log('rows:', Array.isArray(data) ? data.length : 0)
process.exit(0)
