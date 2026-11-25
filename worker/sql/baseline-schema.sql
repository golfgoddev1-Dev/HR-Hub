-- Generated from pg_catalog: public schema, no data

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- 1b. Enum types (needed by table columns)

-- 1c. Sequences (not owned by identity columns)

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

-- 3. Views

-- 4. Primary key, unique, check and exclusion constraints
ALTER TABLE ONLY public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.approval_tokens ADD CONSTRAINT approval_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.attendance_statuses ADD CONSTRAINT attendance_statuses_label_key UNIQUE (label);
ALTER TABLE ONLY public.attendance_statuses ADD CONSTRAINT attendance_statuses_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.auth_sessions ADD CONSTRAINT auth_sessions_login_role_check CHECK ((login_role = ANY (ARRAY['hr'::text, 'meeting_controller'::text, 'employee'::text, 'system_admin'::text])));
ALTER TABLE ONLY public.auth_sessions ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.auth_sessions ADD CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_kind_check CHECK ((kind = ANY (ARRAY['shift_lead_approved'::text, 'shift_lead_rejected'::text, 'employee_approved'::text, 'employee_rejected'::text])));
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_leave_request_id_recipient_employee_id__key UNIQUE (leave_request_id, recipient_employee_id, kind, decision);
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text])));
ALTER TABLE ONLY public.department_approvers ADD CONSTRAINT department_approvers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.department_approvers ADD CONSTRAINT department_approvers_unique UNIQUE (department_id, employee_id);
ALTER TABLE ONLY public.department_shift_leads ADD CONSTRAINT department_shift_leads_department_id_employee_id_key UNIQUE (department_id, employee_id);
ALTER TABLE ONLY public.department_shift_leads ADD CONSTRAINT department_shift_leads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.department_shift_leads ADD CONSTRAINT department_shift_leads_shift_label_check CHECK (((char_length(btrim(shift_label)) >= 1) AND (char_length(btrim(shift_label)) <= 30)));
ALTER TABLE ONLY public.departments ADD CONSTRAINT departments_name_key UNIQUE (name);
ALTER TABLE ONLY public.departments ADD CONSTRAINT departments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_approvers ADD CONSTRAINT employee_approvers_not_self CHECK ((employee_id <> approver_id));
ALTER TABLE ONLY public.employee_approvers ADD CONSTRAINT employee_approvers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_approvers ADD CONSTRAINT employee_approvers_unique UNIQUE (employee_id, approver_id);
ALTER TABLE ONLY public.employee_credentials ADD CONSTRAINT employee_credentials_failed_attempts_check CHECK ((failed_attempts >= 0));
ALTER TABLE ONLY public.employee_credentials ADD CONSTRAINT employee_credentials_pkey PRIMARY KEY (employee_id);
ALTER TABLE ONLY public.employee_leave_quotas ADD CONSTRAINT employee_leave_quotas_pkey PRIMARY KEY (employee_id, leave_type_id, year);
ALTER TABLE ONLY public.employee_leave_quotas ADD CONSTRAINT employee_leave_quotas_quota_days_check CHECK (((quota_days >= (0)::numeric) AND (quota_days <= (366)::numeric)));
ALTER TABLE ONLY public.employee_leave_quotas ADD CONSTRAINT employee_leave_quotas_year_check CHECK (((year >= 2000) AND (year <= 2100)));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_hr_menu_shortcuts_len CHECK (((cardinality(hr_menu_shortcuts) >= 0) AND (cardinality(hr_menu_shortcuts) <= 5)));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_not_own_cc CHECK (((cc_manager_id IS NULL) OR (cc_manager_id <> id)));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_not_own_manager CHECK (((manager_id IS NULL) OR (manager_id <> id)));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_pkey PRIMARY KEY (holiday_date);
ALTER TABLE ONLY public.hr_admins ADD CONSTRAINT hr_admins_pkey PRIMARY KEY (employee_id);
ALTER TABLE ONLY public.leave_action_links ADD CONSTRAINT leave_action_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.leave_action_links ADD CONSTRAINT leave_action_links_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_dates_valid CHECK ((end_date >= start_date));
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_decided_consistent CHECK (((status = 'pending'::text) OR (decided_at IS NOT NULL)));
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_days_check CHECK ((days > (0)::numeric));
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_ot_option_check CHECK (((ot_option IS NULL) OR (ot_option = ANY (ARRAY['OT'::text, 'ไม่ OT'::text]))));
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_request_code_key UNIQUE (request_code);
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_source_check CHECK ((source = ANY (ARRAY['employee'::text, 'hr_backdated'::text])));
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.leave_settings ADD CONSTRAINT leave_settings_leave_retention_days_check CHECK (((leave_retention_days >= 730) AND (leave_retention_days <= 3650)));
ALTER TABLE ONLY public.leave_settings ADD CONSTRAINT leave_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.leave_settings ADD CONSTRAINT leave_settings_retention_range CHECK (((certificate_retention_days >= 30) AND (certificate_retention_days <= 365)));
ALTER TABLE ONLY public.leave_settings ADD CONSTRAINT leave_settings_single_row CHECK ((id = 1));
ALTER TABLE ONLY public.leave_types ADD CONSTRAINT leave_types_attachment_days_check CHECK ((attachment_required_from_days >= 0));
ALTER TABLE ONLY public.leave_types ADD CONSTRAINT leave_types_name_key UNIQUE (name);
ALTER TABLE ONLY public.leave_types ADD CONSTRAINT leave_types_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.legacy_import_map ADD CONSTRAINT legacy_import_map_pkey PRIMARY KEY (legacy_source, legacy_key);
ALTER TABLE ONLY public.meeting_admins ADD CONSTRAINT meeting_admins_pkey PRIMARY KEY (employee_id);
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_session_employee_unique UNIQUE (session_id, employee_id);
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_shift_check CHECK (((shift IS NULL) OR (shift = ANY (ARRAY['กะ A'::text, 'กะ B'::text]))));
ALTER TABLE ONLY public.meeting_roster ADD CONSTRAINT meeting_roster_pkey PRIMARY KEY (meeting_type_id, employee_id);
ALTER TABLE ONLY public.meeting_sessions ADD CONSTRAINT meeting_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.meeting_sessions ADD CONSTRAINT meeting_sessions_time_order CHECK (((open_time IS NULL) OR (cutoff_time IS NULL) OR (cutoff_time > open_time)));
ALTER TABLE ONLY public.meeting_sessions ADD CONSTRAINT meeting_sessions_type_date_time_unique UNIQUE (meeting_type_id, session_date, session_time);
ALTER TABLE ONLY public.meeting_skip_dates ADD CONSTRAINT meeting_skip_dates_pkey PRIMARY KEY (skip_date);
ALTER TABLE ONLY public.meeting_types ADD CONSTRAINT meeting_types_code_key UNIQUE (code);
ALTER TABLE ONLY public.meeting_types ADD CONSTRAINT meeting_types_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.name_prefixes ADD CONSTRAINT name_prefixes_name_key UNIQUE (name);
ALTER TABLE ONLY public.name_prefixes ADD CONSTRAINT name_prefixes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.national_id_view_log ADD CONSTRAINT national_id_view_log_pkey PRIMARY KEY (viewer_id, view_date);
ALTER TABLE ONLY public.national_id_view_log ADD CONSTRAINT national_id_view_log_view_count_check CHECK ((view_count > 0));
ALTER TABLE ONLY public.notification_logs ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notification_queue ADD CONSTRAINT notification_queue_attempts_check CHECK ((attempts >= 0));
ALTER TABLE ONLY public.notification_queue ADD CONSTRAINT notification_queue_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notification_queue ADD CONSTRAINT notification_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.pin_reset_codes ADD CONSTRAINT pin_reset_codes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.positions ADD CONSTRAINT positions_name_key UNIQUE (name);
ALTER TABLE ONLY public.positions ADD CONSTRAINT positions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
ALTER TABLE ONLY public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shift_options ADD CONSTRAINT shift_options_label_key UNIQUE (label);
ALTER TABLE ONLY public.shift_options ADD CONSTRAINT shift_options_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.system_admins ADD CONSTRAINT system_admins_pkey PRIMARY KEY (employee_id);

-- 5. Foreign keys
ALTER TABLE ONLY public.approval_tokens ADD CONSTRAINT approval_tokens_approver_employee_id_fkey FOREIGN KEY (approver_employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.approval_tokens ADD CONSTRAINT approval_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.approval_tokens ADD CONSTRAINT approval_tokens_leave_request_id_fkey FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.auth_sessions ADD CONSTRAINT auth_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_leave_request_id_fkey FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.decision_email_jobs ADD CONSTRAINT decision_email_jobs_recipient_employee_id_fkey FOREIGN KEY (recipient_employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.department_approvers ADD CONSTRAINT department_approvers_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.department_approvers ADD CONSTRAINT department_approvers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.department_shift_leads ADD CONSTRAINT department_shift_leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.department_shift_leads ADD CONSTRAINT department_shift_leads_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.department_shift_leads ADD CONSTRAINT department_shift_leads_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_approvers ADD CONSTRAINT employee_approvers_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_approvers ADD CONSTRAINT employee_approvers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_credentials ADD CONSTRAINT employee_credentials_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_leave_quotas ADD CONSTRAINT employee_leave_quotas_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_leave_quotas ADD CONSTRAINT employee_leave_quotas_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_leave_quotas ADD CONSTRAINT employee_leave_quotas_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_cc_manager_id_fkey FOREIGN KEY (cc_manager_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_position_id_fkey FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.hr_admins ADD CONSTRAINT hr_admins_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.leave_action_links ADD CONSTRAINT leave_action_links_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.leave_action_links ADD CONSTRAINT leave_action_links_leave_request_id_fkey FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_cc_manager_id_fkey FOREIGN KEY (cc_manager_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_entered_by_id_fkey FOREIGN KEY (entered_by_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.leave_requests ADD CONSTRAINT leave_requests_shift_option_fkey FOREIGN KEY (shift_option_code) REFERENCES shift_options(code) ON DELETE RESTRICT;
ALTER TABLE ONLY public.leave_settings ADD CONSTRAINT leave_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.meeting_admins ADD CONSTRAINT meeting_admins_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_position_id_fkey FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES meeting_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.meeting_attendance ADD CONSTRAINT meeting_attendance_status_code_fkey FOREIGN KEY (status_code) REFERENCES attendance_statuses(code);
ALTER TABLE ONLY public.meeting_roster ADD CONSTRAINT meeting_roster_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.meeting_roster ADD CONSTRAINT meeting_roster_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.meeting_roster ADD CONSTRAINT meeting_roster_meeting_type_id_fkey FOREIGN KEY (meeting_type_id) REFERENCES meeting_types(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.meeting_sessions ADD CONSTRAINT meeting_sessions_meeting_type_id_fkey FOREIGN KEY (meeting_type_id) REFERENCES meeting_types(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.national_id_view_log ADD CONSTRAINT national_id_view_log_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES employees(id);
ALTER TABLE ONLY public.notification_logs ADD CONSTRAINT notification_logs_leave_request_id_fkey FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notification_queue ADD CONSTRAINT notification_queue_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notification_queue ADD CONSTRAINT notification_queue_leave_request_id_fkey FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pin_reset_codes ADD CONSTRAINT pin_reset_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.pin_reset_codes ADD CONSTRAINT pin_reset_codes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.push_subscriptions ADD CONSTRAINT push_subscriptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.system_admins ADD CONSTRAINT system_admins_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;

-- 6. Indexes
CREATE INDEX approval_tokens_cleanup_idx ON public.approval_tokens USING btree (created_at);
CREATE UNIQUE INDEX approval_tokens_nonce_hash_key ON public.approval_tokens USING btree (nonce_hash);
CREATE INDEX approval_tokens_request_open_idx ON public.approval_tokens USING btree (leave_request_id, invalidated_at);
CREATE UNIQUE INDEX approval_tokens_token_hash_key ON public.approval_tokens USING btree (token_hash);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);
CREATE INDEX audit_logs_created_idx ON public.audit_logs USING btree (created_at);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs USING btree (entity, entity_id);
CREATE UNIQUE INDEX audit_logs_medical_cert_day_key ON public.audit_logs USING btree (actor_id, entity_id, (((created_at AT TIME ZONE 'Asia/Bangkok'::text))::date)) WHERE (action = 'view_medical_cert'::text);
CREATE INDEX auth_sessions_employee_id_idx ON public.auth_sessions USING btree (employee_id);
CREATE INDEX auth_sessions_employee_idx ON public.auth_sessions USING btree (employee_id);
CREATE INDEX auth_sessions_expires_at_idx ON public.auth_sessions USING btree (expires_at);
CREATE INDEX auth_sessions_revoked_at_idx ON public.auth_sessions USING btree (revoked_at);
CREATE INDEX auth_sessions_token_hash_idx ON public.auth_sessions USING btree (token_hash);
CREATE INDEX decision_email_jobs_status_idx ON public.decision_email_jobs USING btree (status, created_at);
CREATE INDEX department_approvers_lookup_idx ON public.department_approvers USING btree (department_id, priority) WHERE is_active;
CREATE UNIQUE INDEX department_shift_leads_label_key ON public.department_shift_leads USING btree (department_id, lower(btrim(shift_label)));
CREATE INDEX employee_approvers_lookup_idx ON public.employee_approvers USING btree (employee_id, priority) WHERE is_active;
CREATE UNIQUE INDEX employee_credentials_national_id_hash_unique ON public.employee_credentials USING btree (national_id_hash) WHERE (national_id_hash IS NOT NULL);
CREATE UNIQUE INDEX employee_credentials_nid_uidx ON public.employee_credentials USING btree (national_id_hash) WHERE (national_id_hash IS NOT NULL);
CREATE INDEX employees_cc_manager_idx ON public.employees USING btree (cc_manager_id);
CREATE INDEX employees_department_idx ON public.employees USING btree (department_id);
CREATE INDEX employees_manager_idx ON public.employees USING btree (manager_id);
CREATE INDEX employees_position_idx ON public.employees USING btree (position_id);
CREATE INDEX leave_action_links_request_idx ON public.leave_action_links USING btree (leave_request_id);
CREATE INDEX leave_requests_approver_idx ON public.leave_requests USING btree (approver_id, status);
CREATE INDEX leave_requests_approver_pending_idx ON public.leave_requests USING btree (approver_id, status);
CREATE INDEX leave_requests_approver_status_decided_at_idx ON public.leave_requests USING btree (approver_id, status, decided_at DESC);
CREATE INDEX leave_requests_employee_idx ON public.leave_requests USING btree (employee_id, start_date);
CREATE INDEX leave_requests_shift_idx ON public.leave_requests USING btree (shift_option_code);
CREATE INDEX leave_requests_source_idx ON public.leave_requests USING btree (source);
CREATE INDEX leave_requests_status_decided_at_idx ON public.leave_requests USING btree (status, decided_at DESC);
CREATE INDEX leave_requests_status_end_date_idx ON public.leave_requests USING btree (status, end_date);
CREATE INDEX leave_requests_type_idx ON public.leave_requests USING btree (leave_type_id);
CREATE INDEX meeting_attendance_employee_idx ON public.meeting_attendance USING btree (employee_id);
CREATE INDEX meeting_sessions_cycle_idx ON public.meeting_sessions USING btree (meeting_type_id, cycle_key);
CREATE UNIQUE INDEX meeting_types_qr_token_key ON public.meeting_types USING btree (qr_token);
CREATE INDEX notification_logs_request_idx ON public.notification_logs USING btree (leave_request_id);
CREATE INDEX notification_queue_due_idx ON public.notification_queue USING btree (status, next_attempt_at);
CREATE INDEX notification_queue_employee_idx ON public.notification_queue USING btree (employee_id, created_at DESC);
CREATE INDEX notification_queue_leave_request_id_idx ON public.notification_queue USING btree (leave_request_id);
CREATE INDEX notification_queue_status_created_at_idx ON public.notification_queue USING btree (status, created_at);
CREATE INDEX pin_reset_codes_employee_unused_idx ON public.pin_reset_codes USING btree (employee_id, created_at DESC) WHERE (used_at IS NULL);
CREATE INDEX push_subscriptions_employee_idx ON public.push_subscriptions USING btree (employee_id) WHERE is_active;

-- 7. Row level security
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_shift_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leave_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees_fullname_backup_20261111 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_action_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_skip_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.name_prefixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.national_id_view_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_admins ENABLE ROW LEVEL SECURITY;

-- 8. Functions (before policies, which may call them)
CREATE OR REPLACE FUNCTION public.increment_national_id_view(p_viewer uuid, p_day date)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.national_id_view_log (viewer_id, view_date, view_count, updated_at)
  values (p_viewer, p_day, 1, now())
  on conflict (viewer_id, view_date)
  do update set view_count = public.national_id_view_log.view_count + 1,
                updated_at = now()
  returning view_count;
$function$
;

-- 9. Policies

-- 10. Triggers