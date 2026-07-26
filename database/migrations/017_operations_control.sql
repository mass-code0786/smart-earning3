CREATE TABLE system_module_controls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),module_name varchar(48) NOT NULL UNIQUE,
 is_paused boolean NOT NULL DEFAULT false,pause_reason varchar(500),paused_by uuid REFERENCES users(id),paused_at timestamptz,
 resumed_by uuid REFERENCES users(id),resumed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((is_paused AND pause_reason IS NOT NULL AND paused_at IS NOT NULL AND paused_by IS NOT NULL) OR NOT is_paused)
);
INSERT INTO system_module_controls(module_name) VALUES
 ('MAGIC_FUNDING_WORKER'),('MAGIC_DISTRIBUTION_WORKER'),('DIVIDEND_WORKER'),('BOOSTER_WORKER'),
 ('GLOBAL_AUTOPOOL_WORKER'),('AUTO_WITHDRAW_WORKER'),('WITHDRAWAL_BROADCAST'),('X3_PLACEMENT'),
 ('X4_PLACEMENT'),('PACKAGE_PURCHASE');

CREATE TABLE worker_heartbeats (
 worker_name varchar(64) NOT NULL,instance_id varchar(100) NOT NULL,last_started_at timestamptz NOT NULL DEFAULT now(),
 last_heartbeat_at timestamptz NOT NULL DEFAULT now(),last_success_at timestamptz,last_failure_at timestamptz,
 last_error_code varchar(80),last_error_message varchar(500),
 current_status varchar(16) NOT NULL CHECK(current_status IN('STARTING','RUNNING','IDLE','DEGRADED','FAILED','STOPPED','DISABLED','PAUSED')),
 processed_count bigint NOT NULL DEFAULT 0 CHECK(processed_count>=0),failed_count bigint NOT NULL DEFAULT 0 CHECK(failed_count>=0),
 expected_interval_seconds integer NOT NULL CHECK(expected_interval_seconds>=10),metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(worker_name,instance_id)
);

CREATE TABLE operations_admin_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admin_user_id uuid NOT NULL REFERENCES users(id),action_type varchar(64) NOT NULL,
 module_name varchar(48),target_type varchar(48),target_id varchar(200),reason varchar(500) NOT NULL CHECK(length(trim(reason))>=3),
 confirmation_phrase varchar(80),previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,new_state jsonb NOT NULL DEFAULT '{}'::jsonb,
 request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operations_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alert_type varchar(64) NOT NULL,
 severity varchar(12) NOT NULL CHECK(severity IN('INFO','WARNING','HIGH','CRITICAL')),module_name varchar(48),
 title varchar(160) NOT NULL,description varchar(1000) NOT NULL,source_reference varchar(200) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED')),
 first_detected_at timestamptz NOT NULL DEFAULT now(),last_detected_at timestamptz NOT NULL DEFAULT now(),
 acknowledged_at timestamptz,acknowledged_by uuid REFERENCES users(id),resolved_at timestamptz,
 resolved_by uuid REFERENCES users(id),resolution_note varchar(1000),
 CHECK(status<>'RESOLVED' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(trim(resolution_note))>=3))
);
CREATE UNIQUE INDEX operations_alert_one_active_source_idx ON operations_alerts(alert_type,source_reference) WHERE status<>'RESOLVED';

CREATE TABLE reconciliation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reconciliation_type varchar(48) NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,status varchar(16) NOT NULL CHECK(status IN('RUNNING','COMPLETED','FAILED')),
 scanned_count bigint NOT NULL DEFAULT 0,matched_count bigint NOT NULL DEFAULT 0,mismatched_count bigint NOT NULL DEFAULT 0,
 missing_database_count bigint NOT NULL DEFAULT 0,missing_chain_count bigint NOT NULL DEFAULT 0,
 total_database_amount numeric(78,0) NOT NULL DEFAULT 0,total_chain_amount numeric(78,0) NOT NULL DEFAULT 0,
 error_summary varchar(1000),initiated_by uuid REFERENCES users(id),metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE operations_retry_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),retry_type varchar(40) NOT NULL CHECK(retry_type IN('MAGIC_FUNDING','WITHDRAWAL')),
 target_id uuid NOT NULL,idempotency_key varchar(200) NOT NULL UNIQUE,requested_by uuid NOT NULL REFERENCES users(id),
 request_reason varchar(500) NOT NULL CHECK(length(trim(request_reason))>=3),
 status varchar(24) NOT NULL CHECK(status IN('PENDING','PROCESSING','COMPLETED','REJECTED','FAILED')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),created_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,result_summary varchar(1000)
);
CREATE UNIQUE INDEX operations_retry_one_active_target_idx ON operations_retry_requests(retry_type,target_id) WHERE status IN('PENDING','PROCESSING');
CREATE INDEX worker_heartbeat_status_idx ON worker_heartbeats(current_status,last_heartbeat_at);
CREATE INDEX operations_alert_status_idx ON operations_alerts(status,severity,last_detected_at DESC);
CREATE INDEX reconciliation_runs_type_idx ON reconciliation_runs(reconciliation_type,started_at DESC);
CREATE INDEX operations_actions_created_idx ON operations_admin_actions(created_at DESC);
CREATE INDEX operations_retry_status_idx ON operations_retry_requests(status,created_at);
CREATE TRIGGER operations_admin_actions_append_only BEFORE UPDATE OR DELETE ON operations_admin_actions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
