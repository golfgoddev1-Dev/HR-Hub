-- Baseline schema (public), generated from pg_catalog. Apply to an EMPTY database only.
-- Production already has these objects; do not run against it.

-- 2. Tables
CREATE TABLE public.app_settings (
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.approval_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  leave_request_id uuid NOT NULL,
  approver_employee_id uuid NOT NULL,
  token_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  invalidated_at timestamp with time zone,
  created_by uuid,
  nonce_hash text
);
CREATE TABLE public.attendance_statuses (
  code text NOT NULL,
  label text NOT NULL
);
CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  detail jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.auth_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_active_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  login_role text
);
CREATE TABLE public.backup_meeting_attendance_20261102 (
  id uuid,
  session_id uuid,
  employee_id uuid,
  status_code text,
  reason text,
  department_id uuid,
  position_id uuid,
  registered_at timestamp with time zone,
  shift text
);
CREATE TABLE public.backup_meeting_sessions_20261102 (
  id uuid,
  meeting_type_id uuid,
  session_date date,
  cycle_key text,
  open_time time without time zone,
  cutoff_time time without time zone,
  created_at timestamp with time zone,
  session_time text,
  location text
);
CREATE TABLE public.decision_email_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  leave_request_id uuid NOT NULL,
  recipient_employee_id uuid NOT NULL,
  kind text NOT NULL,
  decision text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone
);
CREATE TABLE public.department_approvers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  department_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.department_shift_leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  department_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  shift_label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid
);
CREATE TABLE public.departments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL
);
CREATE TABLE public.employee_approvers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.employee_credentials (
  employee_id uuid NOT NULL,
  national_id_hash text,
  pin_hash text,
  pin_set_at timestamp with time zone,
  failed_attempts integer DEFAULT 0 NOT NULL,
  locked_until timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  national_id_enc text,
  must_change_pin boolean DEFAULT false NOT NULL
);
CREATE TABLE public.employee_leave_quotas (
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  year integer NOT NULL,
  quota_days numeric(4,1) NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE public.employees (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_code text,
  full_name text NOT NULL,
  email text,
  department_id uuid,
  position_id uuid,
  manager_id uuid,
  cc_manager_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  name_prefix text,
  phone text,
  notify_pending_on_logout boolean DEFAULT true NOT NULL,
  pending_notice_at timestamp with time zone,
  notifications_enabled boolean DEFAULT false NOT NULL,
  hr_menu_shortcuts text[] DEFAULT '{}'::text[] NOT NULL
);
CREATE TABLE public.employees_fullname_backup_20261111 (
  id uuid,
  full_name text,
  name_prefix text
);
CREATE TABLE public.holidays (
  holiday_date date NOT NULL,
  name text NOT NULL
);
CREATE TABLE public.hr_admins (
  employee_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.leave_action_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  leave_request_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.leave_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  request_code text NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  other_type_detail text,
  ot_option text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(4,1) NOT NULL,
  return_date date,
  return_time time without time zone,
  reason text,
  medical_certificate_url text,
  status text DEFAULT 'pending'::text NOT NULL,
  approver_id uuid,
  cc_manager_id uuid,
  decided_at timestamp with time zone,
  decision_note text,
  pdf_url text,
  pdf_error text,
  hr_sent_status text,
  hr_sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  shift_option_code text NOT NULL,
  shift_end_override time without time zone,
  source text DEFAULT 'employee'::text NOT NULL,
  entered_by_id uuid,
  has_medical_certificate boolean DEFAULT false NOT NULL
);
CREATE TABLE public.leave_settings (
  id smallint DEFAULT 1 NOT NULL,
  certificate_retention_days integer DEFAULT 90 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  leave_retention_enabled boolean DEFAULT false NOT NULL,
  leave_retention_days integer DEFAULT 1825 NOT NULL
);
CREATE TABLE public.leave_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  requires_attachment boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  attachment_required_from_days integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.legacy_import_map (
  legacy_source text NOT NULL,
  legacy_key text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  imported_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.meeting_admins (
  employee_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.meeting_attendance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status_code text NOT NULL,
  reason text,
  department_id uuid,
  position_id uuid,
  registered_at timestamp with time zone NOT NULL,
  shift text
);
CREATE TABLE public.meeting_roster (
  employee_id uuid NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  meeting_type_id uuid NOT NULL
);
CREATE TABLE public.meeting_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  meeting_type_id uuid NOT NULL,
  session_date date NOT NULL,
  cycle_key text NOT NULL,
  open_time time without time zone,
  cutoff_time time without time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  session_time text DEFAULT ''::text NOT NULL,
  location text
);
CREATE TABLE public.meeting_skip_dates (
  skip_date date NOT NULL,
  note text
);
CREATE TABLE public.meeting_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  qr_token text NOT NULL,
  weekday smallint,
  default_open_time time without time zone,
  default_cutoff_time time without time zone
);
CREATE TABLE public.name_prefixes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL
);
CREATE TABLE public.national_id_view_log (
  viewer_id uuid NOT NULL,
  view_date date NOT NULL,
  view_count integer DEFAULT 1 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.notification_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  leave_request_id uuid,
  recipient_email text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.notification_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  leave_request_id uuid,
  kind text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pin_reset_codes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  code_hash text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.positions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone,
  signed_out boolean DEFAULT false NOT NULL,
  signed_out_at timestamp with time zone
);
CREATE TABLE public.shift_options (
  code text NOT NULL,
  label text NOT NULL,
  time_from time without time zone NOT NULL,
  time_to time without time zone NOT NULL,
  is_half boolean NOT NULL,
  sort_order integer NOT NULL
);
CREATE TABLE public.system_admins (
  employee_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
