import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { nationalIdHash } from '../server/national-id.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true })
const storedHash = '6283873d326dd41d37980227948b620e109f1784b35a7f6b83d1fd3a8974fe99'
console.log(nationalIdHash('1234567890123') === storedHash ? 'MATCH' : 'NO MATCH')
