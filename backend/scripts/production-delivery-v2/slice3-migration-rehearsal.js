#!/usr/bin/env node
// Rehearsal migration slice 3 (20261017100000_production_component_notes_slice3) pada DATABASE UNIK TERISOLASI (pola runIsolated: km_it_*_test, dihapus di akhir; tidak menyentuh DB lain).
//   A. CLEAN  : migrate deploy dari nol -> tabel unit_component_entries_v2 ada + kosong, `migrate status` up-to-date, objek slice 3 tidak muncul di diff drift.
//   B. UPGRADE: migrate deploy SEMUA migration KECUALI slice 3 -> data produksi-like -> deploy slice 3 -> data lama IDENTIK (sidik per tabel); tabel baru kosong; kendala (unik/versi/CHECK/FK)
//               ditegakkan; baris dapat ditulis. BUKTI TEKNIS saja: DROP tabel aditif pada salinan tidak mengubah data lama (BUKAN prosedur production: rollback aplikasi mempertahankan migration).
//   node scripts/production-delivery-v2/slice3-migration-rehearsal.js
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
const SLICE3 = "20261017100000_production_component_notes_slice3";
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
  check("A clean: tabel unit_component_entries_v2 ada & kosong", (await tableExists(ca, "unit_component_entries_v2")) && Number((await ca.$queryRawUnsafe("select count(*)::int c from unit_component_entries_v2"))[0].c) === 0);
  const cl = await cols(ca, "unit_component_entries_v2");
  check("A clean: kolom lengkap (unit_id, run_id, section, version, payload, media, reason, actor_id, command_id, created_at)", ["unit_id", "run_id", "section", "version", "payload", "media", "reason", "actor_id", "command_id", "created_at"].every((c) => cl.includes(c)));
  const status = execFileSync("npx", ["prisma", "migrate", "status"], { cwd: backendRoot, env: { ...process.env, DATABASE_URL: urlOf(a) }, stdio: "pipe", shell: true }).toString();
  check("A clean: migrate status = up to date", /Database schema is up to date/i.test(status));
  let drift = "";
  try { drift = execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", urlOf(a), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], { cwd: backendRoot, stdio: "pipe", shell: true }).toString(); }
  catch (e) { drift = String(e.stdout || e.message); }
  check("A clean: objek slice 3 (unit_component_entries_v2) TIDAK muncul di diff drift", !/unit_component_entries_v2/.test(drift), drift.trim() ? "drift lama non-slice-3 ada (tidak diubah)" : "tanpa drift");
  await ca.$disconnect();

  // ---------------------------------------------------------------- B. UPGRADE ----------------------------------------------------------------
  const b = await mkdb("b");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s3-prisma-"));
  fs.cpSync(path.join(backendRoot, "prisma"), tmp, { recursive: true });
  fs.rmSync(path.join(tmp, "migrations", SLICE3), { recursive: true, force: true });
  deploy(b, { schemaDir: tmp });
  const cb = client(b);
  check("B pra-upgrade: tabel slice 3 BELUM ada", !(await tableExists(cb, "unit_component_entries_v2")));
  const customer = await cb.customer.create({ data: { name: "Rehearsal" }, select: { id: true } });
  const order = await cb.order.create({ data: { customerId: customer.id, orderNumber: `RH3-${Date.now()}`, value: 1000, category: "LAYANAN" }, select: { id: true } });
  const unit = await cb.unit.create({ data: { unitCode: `RH3-U-${Date.now()}`, orderId: order.id, seq: 1, status: "IN_PRODUCTION" }, select: { id: true } });
  const run = await cb.productionRun.create({
    data: { unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 3, startedAt: new Date(), phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: i < 2 ? "COMPLETED" : i === 2 ? "ACTIVE" : "NOT_STARTED" })) } },
    select: { id: true },
  });
  await cb.productionStepEvidence.create({ data: { runId: run.id, stepNo: 1, stepCode: "S01_BEFORE", version: 1, payload: { conditionConfirmed: true }, media: [] }, select: { id: true } });
  const tables = ["production_runs_v2", "production_phase_runs_v2", "production_step_evidence_v2", "units", `"Order"`];
  const before = {}; for (const t of tables) before[t] = await fingerprint(cb, t);
  await cb.$disconnect();

  deploy(b); // seluruh migration termasuk slice 3
  const cb2 = client(b);
  check("B upgrade: sidik tabel lama IDENTIK (run, fase, bukti, unit, order)", (await Promise.all(tables.map(async (t) => (await fingerprint(cb2, t)) === before[t]))).every(Boolean));
  check("B upgrade: tabel baru kosong (tidak ada backfill/data karangan)", Number((await cb2.$queryRawUnsafe("select count(*)::int c from unit_component_entries_v2"))[0].c) === 0);
  const ins = (v, sec = "AFTER") => cb2.$executeRawUnsafe(`insert into unit_component_entries_v2 (id, unit_id, section, version, payload) values (gen_random_uuid(), '${unit.id}'::uuid, '${sec}', ${v}, '{"x":1}'::jsonb)`);
  await ins(1);
  check("B upgrade: baris dapat ditulis", Number((await cb2.$queryRawUnsafe("select count(*)::int c from unit_component_entries_v2"))[0].c) === 1);
  const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
  check("B kendala: (unit, seksi, versi) unik", await fails(() => ins(1)));
  check("B kendala: seksi di luar tiga nilai ditolak (CHECK)", await fails(() => ins(1, "NGAWUR")));
  check("B kendala: versi < 1 ditolak (CHECK)", await fails(() => ins(0, "LAYERS_BEFORE")));
  check("B kendala: FK unit (unit tidak ada ditolak)", await fails(() => cb2.$executeRawUnsafe(`insert into unit_component_entries_v2 (id, unit_id, section, version) values (gen_random_uuid(), gen_random_uuid(), 'AFTER', 1)`)));
  check("B kendala: unit yang punya catatan tidak bisa dihapus diam-diam (ON DELETE RESTRICT)", await fails(() => cb2.$executeRawUnsafe(`delete from units where id='${unit.id}'::uuid`)));
  await cb2.$executeRawUnsafe("DROP TABLE unit_component_entries_v2");
  const cb3 = client(b);
  check("B bukti teknis (bukan prosedur production): data lama utuh walau tabel aditif dibuang", (await Promise.all(tables.map(async (t) => (await fingerprint(cb3, t)) === before[t]))).every(Boolean));
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
