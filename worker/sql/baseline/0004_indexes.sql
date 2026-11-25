-- Baseline schema (public), generated from pg_catalog. Apply to an EMPTY database only.
-- Production already has these objects; do not run against it.

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
