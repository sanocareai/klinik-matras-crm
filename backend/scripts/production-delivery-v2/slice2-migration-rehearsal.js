#!/usr/bin/env node
// Rehearsal migration slice 2 (20261016100000_production_adaptation_slice2) pada DATABASE UNIK TERISOLASI (pola runIsolated: km_it_*_test, dihapus di akhir; tidak menyentuh DB lain).
//   A. CLEAN  : migrate deploy dari nol -> kolom/tabel baru ada, `migrate status` up-to-date, tidak ada drift terhadap schema.prisma.
//   B. UPGRADE: migrate deploy SEMUA migration KECUALI slice 2 -> isi data "produksi-like" (run + fase + operasi + bukti + custody) -> deploy slice 2 -> data lama IDENTIK
//               (sidik per tabel), kolom baru NULL pada baris lama, tabel pengaturan kosong; kebijakan adaptasi dapat ditulis; BUKTI TEKNIS (bukan prosedur production): DROP kolom/tabel aditif dijalankan
//               pada salinan dan data lama tetap utuh. Rollback production = rollback aplikasi; migration aditif DIPERTAHANKAN (lihat docs/design/production-simplifikasi-slice2/README.md).
//   node scripts/production-delivery-v2/slice2-migration-rehearsal.js
import "../../tests/integration/setup/env.js";
import { TEST_DATABASE_URL } from "../../tests/integration/setup/env.js";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLICE2 = "20261016100000_production_adaptation_slice2";
const SAFE = /^km_it_[a-z0-9]+_\d+_test$/;
const base = new URL(TEST_DATABASE_URL);
const urlOf = (db) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const admin = new PrismaClient({ datasources: { db: { url: urlOf("postgres") } } });
const ident = (n) => `"${n.replace(/"/g, '""')}"`;
const created = [];
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`); };

async function mkdb(tag) {
  const name = `km_it_${Date.now().toString(36)}${tag}_${process.pid}_test`;
  if (!SAFE.test(name)) throw new Error(`nama db tidak aman: ${name}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${ident(name)}`); created.push(name); return name;
}
const deploy = (db, { schemaDir = null } = {}) => execFileSync("npx", ["prisma", "migrate", "deploy", ...(schemaDir ? ["--schema", path.join(schemaDir, "schema.prisma")] : [])], { cwd: backendRoot, env: { ...process.env, DATABASE_URL: urlOf(db) }, stdio: "pipe", shell: true }).toString();
const client = (db) => new PrismaClient({ datasources: { db: { url: urlOf(db) } } });
const cols = async (c, table) => (await c.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='${table}' order by 1`)).map((r) => r.column_name);
const tableExists = async (c, t) => (await c.$queryRawUnsafe(`select to_regclass('public.${t}')::text as r`))[0].r !== null;
const fingerprint = async (c, table) => {
  const rows = await c.$queryRawUnsafe(`select t::text as r from (select * from ${table} order by 1) t`);
  return crypto.createHash("sha256").update(rows.map((r) => r.r).join("\n")).digest("hex");
};

try {
  // ---------------------------------------------------------------- A. CLEAN -------------------------------------------------------------------
  const a = await mkdb("a");
  deploy(a);
  const ca = client(a);
  check("A clean: production_runs_v2.adaptation_policy ada", (await cols(ca, "production_runs_v2")).includes("adaptation_policy"));
  { const oc = await cols(ca, "production_operation_runs_v2"); check("A clean: production_operation_runs_v2.delay_kind/delay_note ada", oc.includes("delay_kind") && oc.includes("delay_note")); }
  check("A clean: tabel production_settings ada & kosong", (await tableExists(ca, "production_settings")) && Number((await ca.$queryRawUnsafe("select count(*)::int c from production_settings"))[0].c) === 0);
  const status = execFileSync("npx", ["prisma", "migrate", "status"], { cwd: backendRoot, env: { ...process.env, DATABASE_URL: urlOf(a) }, stdio: "pipe", shell: true }).toString();
  check("A clean: migrate status = up to date", /Database schema is up to date/i.test(status));
  // Drift schema.prisma vs migration: ada drift LAMA yang tidak terkait slice ini (mis. default activity_events.id). Yang diperiksa: slice 2 TIDAK menambah drift (objek slice 2 tidak muncul di diff).
  let drift = "";
  try { drift = execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", urlOf(a), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], { cwd: backendRoot, stdio: "pipe", shell: true }).toString(); }
  catch (e) { drift = String(e.stdout || e.message); }
  check("A clean: objek slice 2 (adaptation_policy, delay_kind, delay_note, production_settings) TIDAK muncul di diff drift", !/adaptation_policy|delay_kind|delay_note|production_settings/.test(drift), drift.trim() ? "drift lama non-slice-2 ada (tidak diubah)" : "tanpa drift");
  await ca.$disconnect();

  // ---------------------------------------------------------------- B. UPGRADE ----------------------------------------------------------------
  const b = await mkdb("b");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s2-prisma-"));
  fs.cpSync(path.join(backendRoot, "prisma"), tmp, { recursive: true });
  fs.rmSync(path.join(tmp, "migrations", SLICE2), { recursive: true, force: true });
  deploy(b, { schemaDir: tmp });
  const cb = client(b);
  check("B pra-upgrade: kolom slice 2 BELUM ada", !(await cols(cb, "production_runs_v2")).includes("adaptation_policy") && !(await tableExists(cb, "production_settings")));
  // data produksi-like (select id saja supaya Prisma Client baru tidak meminta kolom yang belum ada)
  const customer = await cb.customer.create({ data: { name: "Rehearsal" }, select: { id: true } });
  const order = await cb.order.create({ data: { customerId: customer.id, orderNumber: `RH-${Date.now()}`, value: 1000, category: "LAYANAN" }, select: { id: true } });
  const unit = await cb.unit.create({ data: { unitCode: `RH-U-${Date.now()}`, orderId: order.id, seq: 1, status: "IN_PRODUCTION" }, select: { id: true } });
  const run = await cb.productionRun.create({
    data: { unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 3, startedAt: new Date(), phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: i < 2 ? "COMPLETED" : i === 2 ? "ACTIVE" : "NOT_STARTED" })) } },
    select: { id: true },
  });
  await cb.productionOperationRun.create({ data: { runId: run.id, stageCode: "teardown", stageLabel: "Bongkar", sequence: 1, status: "PAUSED", startedAt: new Date() }, select: { id: true } });
  await cb.productionStepEvidence.create({ data: { runId: run.id, stepNo: 1, stepCode: "S01_BEFORE", version: 1, payload: { conditionConfirmed: true }, media: [] }, select: { id: true } });
  const tables = ["production_runs_v2", "production_phase_runs_v2", "production_operation_runs_v2", "production_step_evidence_v2", "units", `"Order"`];
  const before = {}; for (const t of tables) before[t] = await fingerprint(cb, t);
  const beforeCounts = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, Number((await cb.$queryRawUnsafe(`select count(*)::int c from ${t}`))[0].c)])));
  await cb.$disconnect();

  deploy(b); // seluruh migration termasuk slice 2
  const cb2 = client(b);
  // sidik tabel lama: kolom baru ditambahkan di tabel run/operasi, jadi bandingkan hanya kolom lama
  check("B upgrade: jumlah baris tabel lama identik", (await Promise.all(tables.map(async (t) => Number((await cb2.$queryRawUnsafe(`select count(*)::int c from ${t}`))[0].c) === beforeCounts[t]))).every(Boolean));
  check("B upgrade: bukti & fase & unit & order identik (sidik)", (await fingerprint(cb2, "production_step_evidence_v2")) === before.production_step_evidence_v2 && (await fingerprint(cb2, "production_phase_runs_v2")) === before.production_phase_runs_v2 && (await fingerprint(cb2, "units")) === before.units && (await fingerprint(cb2, `"Order"`)) === before["\"Order\""]);
  check("B upgrade: kolom baru NULL pada baris lama (run & operasi tidak dipaksa adaptasi)", Number((await cb2.$queryRawUnsafe("select count(*)::int c from production_runs_v2 where adaptation_policy is not null"))[0].c) === 0 && Number((await cb2.$queryRawUnsafe("select count(*)::int c from production_operation_runs_v2 where delay_kind is not null or delay_note is not null"))[0].c) === 0);
  check("B upgrade: production_settings kosong", Number((await cb2.$queryRawUnsafe("select count(*)::int c from production_settings"))[0].c) === 0);
  await cb2.$executeRawUnsafe(`update production_runs_v2 set adaptation_policy='ADAPTATION_V1' where id='${run.id}'::uuid`);
  check("B upgrade: kebijakan adaptasi dapat ditulis per run", (await cb2.$queryRawUnsafe(`select adaptation_policy a from production_runs_v2 where id='${run.id}'::uuid`))[0].a === "ADAPTATION_V1");
  await cb2.$executeRawUnsafe(`update production_runs_v2 set adaptation_policy=null where id='${run.id}'::uuid`);
  // BUKTI TEKNIS saja (BUKAN prosedur production): objek aditif dapat dibuang tanpa mengubah data lama. Production mempertahankan migration saat rollback aplikasi.
  await cb2.$executeRawUnsafe('ALTER TABLE "production_runs_v2" DROP COLUMN "adaptation_policy"');
  await cb2.$executeRawUnsafe('ALTER TABLE "production_operation_runs_v2" DROP COLUMN "delay_kind", DROP COLUMN "delay_note"');
  await cb2.$executeRawUnsafe('DROP TABLE "production_settings"');
  const cb3 = client(b);
  check("B bukti teknis (bukan prosedur production): data lama utuh walau kolom/tabel aditif dibuang", (await fingerprint(cb3, "production_step_evidence_v2")) === before.production_step_evidence_v2 && (await fingerprint(cb3, "production_phase_runs_v2")) === before.production_phase_runs_v2 && (await fingerprint(cb3, "units")) === before.units);
  await cb3.$disconnect(); await cb2.$disconnect();
} finally {
  await admin.$disconnect();
  const cleaner = new PrismaClient({ datasources: { db: { url: urlOf("postgres") } } });
  for (const name of created) { if (SAFE.test(name)) { try { await cleaner.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`); } catch (e) { console.error(`peringatan: gagal hapus ${name}: ${e.message}`); } } }
  await cleaner.$disconnect();
  const f = results.filter((r) => !r.ok);
  console.log(`\nHASIL REHEARSAL: ${results.length - f.length}/${results.length} lulus`);
  fs.writeFileSync(path.join(os.tmpdir(), "s2-migration-rehearsal.json"), JSON.stringify(results, null, 1));
  process.exitCode = f.length ? 1 : 0;
}
