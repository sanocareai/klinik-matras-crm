-- CreateTable
CREATE TABLE "mcp_oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_authorization_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_key" ON "mcp_oauth_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_authorization_codes_code_key" ON "mcp_authorization_codes"("code");

-- CreateIndex
CREATE INDEX "mcp_authorization_codes_expires_at_idx" ON "mcp_authorization_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_refresh_tokens_token_hash_key" ON "mcp_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "mcp_refresh_tokens_user_id_idx" ON "mcp_refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "mcp_authorization_codes" ADD CONSTRAINT "mcp_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_refresh_tokens" ADD CONSTRAINT "mcp_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
