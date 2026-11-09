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
import meetingBackfill from "./routes/backfill.js";
import { createEmployeeDirectoryRoutes } from "./routes/employee-directory.js";
import leave from "./routes/leave.js";
import leaveCalendar from "./routes/leave-calendar.js";
import leaveHr from "./routes/leave-hr.js";
import approveLink from "./routes/approve-link.js";
import admin from "./routes/admin.js";
import profile from "./routes/profile.js";
import notifications from "./routes/notifications.js";
import { addServerTiming } from "./server-timing.js";

const app = new Hono();

// Measure every API response (total handler time) before any route matches.
app.use("*", addServerTiming);

// Every API answer depends on the session cookie, so none of them may be kept by
// the browser HTTP cache, a shared proxy or the back/forward cache. Routes may
// still set a stricter or more specific value; this guarantee applies when they
// forget, and it overrides the old reusable lookup values.
// The approvals count is the one caller-specific read a browser may keep briefly:
// it sends its own "private, no-cache" so a matching ETag can answer 304. Every
// other response, and every route that forgot, still gets "no-store" here.
const CONDITIONAL_CACHE_CONTROL = "private, no-cache";

app.use("*", async (c, next) => {
  await next();
  if (c.res.headers.get("Cache-Control") !== CONDITIONAL_CACHE_CONTROL) {
    c.header("Cache-Control", "no-store");
  }
});

app.route("/api/auth", auth);
app.route("/api/register", register);
app.route("/api/notifications", notifications);
app.route("/api/leave/hr", leaveHr);
app.route("/api/admin", admin);
app.route("/api/profile", profile);
// Mounted before /api/leave so the calendar path matches its own app first.
app.route("/api/leave/calendar", leaveCalendar);
// Public approval-by-email routes: no session, own rate limiting.
app.route("/api/approve-link", approveLink);
app.route("/api/leave", leave);
app.route("/api/meeting/monthly-session", monthlySession);
app.route("/api/meeting/roster", meetingRoster);
app.route("/api/meeting/overview", meetingOverview);
app.route("/api/meeting/dashboard", meetingDashboard);
app.route("/api/meeting/dashboard", dashboardReason);
// Registered before /api/meeting so the backfill paths match first.
app.route("/api/meeting/backfill", meetingBackfill);
app.route("/api/meeting", meeting);
app.route("/api/hr/employees", hrEmployees);

// The same handlers serve both roles: /api/hr/directory for HR and
// /api/meeting/directory for meeting controllers. Each mount re-checks its
// own login role and its own membership table.
app.route(
  "/api/hr/directory",
  createEmployeeDirectoryRoutes({ role: "hr", adminTable: "hr_admins" })
);
app.route(
  "/api/meeting/directory",
  createEmployeeDirectoryRoutes({
    role: "meeting_controller",
    adminTable: "meeting_admins",
  })
);

export default app;
