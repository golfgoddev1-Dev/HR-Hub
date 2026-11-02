// Workers API app: auth, public registration, controller meeting settings,
// roster, overview, dashboard reads (Phase 3a) and the dashboard reason
// route (Phase 3b). Auto-absent arrives in Phase 4.

import { Hono } from "hono";

import auth from "./routes/auth.js";
import register from "./routes/register.js";
import meeting from "./routes/meeting.js";
import meetingRoster from "./routes/meeting-roster.js";
import meetingOverview from "./routes/meeting-overview.js";
import monthlySession from "./routes/meeting-monthly.js";
import meetingDashboard from "./routes/meeting-dashboard.js";
import dashboardReason from "./routes/dashboard-reason.js";
import hrEmployees from "./routes/hr-employees.js";

const app = new Hono();

app.route("/api/auth", auth);
app.route("/api/register", register);
app.route("/api/meeting/monthly-session", monthlySession);
app.route("/api/meeting/roster", meetingRoster);
app.route("/api/meeting/overview", meetingOverview);
app.route("/api/meeting/dashboard", meetingDashboard);
app.route("/api/meeting/dashboard", dashboardReason);
app.route("/api/meeting", meeting);
app.route("/api/hr/employees", hrEmployees);

export default app;
