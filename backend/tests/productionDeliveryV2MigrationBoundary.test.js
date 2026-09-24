import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(backendRoot, "prisma", "migrations");
const financeMigration = "20260924090000_uang_muka_operasional";
const v2Migrations = [
  "20260925000000_production_delivery_v2_foundation",
  "20260925010000_delivery_v2_sync_foundation",
  "20260925020000_delivery_job_cancellation_tombstone",
];

function migrationSql(name) {
  return fs.readFileSync(path.join(migrationsRoot, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
}

test("historical Conversation index provenance remains immutable in Finance migration", () => {
  const sql = migrationSql(financeMigration);
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  assert.equal(checksum, "6e213829b2170aa58de64ffe12e8e2475eebb84f1cd3cc516a57b1dfb3db8776");
  assert.match(sql, /CREATE INDEX "Conversation_customerId_channel_idx" ON "Conversation"\("customerId", "channel"\);/);
});

test("full migration chain creates the Conversation index exactly once before V2", () => {
  const directories = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const createIndex = /CREATE INDEX "Conversation_customerId_channel_idx" ON "Conversation"\("customerId", "channel"\);/;
  const owners = directories.filter((name) => createIndex.test(migrationSql(name)));
  assert.deepEqual(owners, [financeMigration]);
  assert.ok(directories.indexOf(financeMigration) < directories.indexOf(v2Migrations[0]));
});

test("Production-Delivery V2 migrations do not touch Sales or Messenger objects", () => {
  const forbidden = [
    "Conversation", "Message", "Customer", "BroadcastCampaign", "BroadcastTarget",
    "PipelineTransition", "ReplySuggestionLog", "ConversationQualityScore",
  ];
  for (const name of v2Migrations) {
    const sql = migrationSql(name);
    for (const objectName of forbidden) {
      assert.equal(sql.includes(`\"${objectName}\"`), false, `${name} references ${objectName}`);
    }
  }
});

test("V2 DDL targets only Production-Delivery foundation objects", () => {
  const allowedTarget = /^(?:v2_|domain_outbox$|production_|diagnosis_reports_v2$|quality_|delivery_|route_|driver_)/;
  for (const name of v2Migrations) {
    const sql = migrationSql(name);
    const targets = [
      ...sql.matchAll(/CREATE TABLE "([^"]+)"/g),
      ...sql.matchAll(/ALTER TABLE "([^"]+)"/g),
      ...sql.matchAll(/CREATE(?: UNIQUE)? INDEX "[^"]+" ON "([^"]+)"/g),
    ].map((match) => match[1]);
    assert.ok(targets.length > 0, `${name} has no audited DDL targets`);
    for (const target of targets) {
      assert.match(target, allowedTarget, `${name} has out-of-bound DDL target ${target}`);
    }
  }
});
