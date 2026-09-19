-- Finance Android (S0): sesi mobile terpisah, token perangkat FCM, dan
-- Idempotency-Key untuk command uang. Additive — tidak menyentuh tabel lama.

CREATE TABLE "mobile_sessions" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "device_label" TEXT,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "app_version" TEXT,
  "refresh_token_hash" TEXT NOT NULL,
  "prev_refresh_token_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refresh_expires_at" TIMESTAMP(3) NOT NULL,
  "absolute_expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" TEXT,
  CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mobile_sessions_refresh_token_hash_key" ON "mobile_sessions"("refresh_token_hash");
CREATE INDEX "mobile_sessions_user_id_revoked_at_idx" ON "mobile_sessions"("user_id", "revoked_at");
CREATE INDEX "mobile_sessions_prev_refresh_token_hash_idx" ON "mobile_sessions"("prev_refresh_token_hash");
ALTER TABLE "mobile_sessions"
  ADD CONSTRAINT "mobile_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mobile_device_tokens" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_id" UUID,
  "device_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "provider" TEXT NOT NULL DEFAULT 'fcm',
  "fcm_token" TEXT NOT NULL,
  "app_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mobile_device_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mobile_device_tokens_fcm_token_key" ON "mobile_device_tokens"("fcm_token");
CREATE UNIQUE INDEX "mobile_device_tokens_user_id_device_id_key" ON "mobile_device_tokens"("user_id", "device_id");
CREATE INDEX "mobile_device_tokens_session_id_idx" ON "mobile_device_tokens"("session_id");
ALTER TABLE "mobile_device_tokens"
  ADD CONSTRAINT "mobile_device_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_device_tokens"
  ADD CONSTRAINT "mobile_device_tokens_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "mobile_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "api_idempotency_keys" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PROCESSING',
  "response_status" INTEGER,
  "response_body" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "api_idempotency_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_idempotency_keys_user_id_key_key" ON "api_idempotency_keys"("user_id", "key");
CREATE INDEX "api_idempotency_keys_created_at_idx" ON "api_idempotency_keys"("created_at");
