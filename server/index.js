import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import meetingRoutes from './routes/meeting.js'
import meetingRosterRoutes from './routes/meeting-roster.js'
import monthlySessionRoutes from './routes/meeting-monthly.js'
import meetingOverviewRoutes from './routes/meeting-overview.js'
import meetingDashboardRoutes from './routes/meeting-dashboard.js'
import registerRoutes from './routes/register.js'
import { getSupabase } from './supabase.js'
import { startAutoAbsentJob } from './auto-absent-job.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(directory, '../.env.local') })

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/auth', authRoutes)
app.use('/api/register', registerRoutes)
app.use('/api/meeting/monthly-session', monthlySessionRoutes)
app.use('/api/meeting/overview', meetingOverviewRoutes)
app.use('/api/meeting/dashboard', meetingDashboardRoutes)
app.use('/api/meeting/roster', meetingRosterRoutes)
app.use('/api/meeting', meetingRoutes)

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(directory, '../dist')
  app.use(express.static(distPath))
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(3001, () => {
  console.log('API server listening on port 3001')
  if (process.env.AUTO_ABSENT_ENABLED !== 'false') {
    try {
      startAutoAbsentJob(getSupabase())
    } catch (error) {
      console.error('[auto-absent-start-error]', error?.name)
    }
  }
})
