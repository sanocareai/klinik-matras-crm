// Rekonsiliasi catatan Gudang lewat CLI --db (READ ONLY) di DB terisolasi: tidak ada tulis, lembar cek fisik buta, --apply ditolak.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { TEST_DATABASE_URL } from "./setup/env.js";

test.before(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HEAD = Array(70).fill("");
[[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"],
  [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => { HEAD[i] = v; });
const row = (nama, satuan, sep, keluar, sisa) => { const r = Array(70).fill(""); r[1] = nama; r[2] = satuan; r[3] = "MATERIAL"; r[47] = sep; r[49] = satuan; r[54] = keluar; r[55] = sisa; return r; };
const cwd = path.resolve(import.meta.dirname, "../..");
const cli = (args) => spawnSync(process.execPath, ["scripts/opname-rekon-catatan-gudang.mjs", ...args], { cwd, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8" });

test("CLI --db: prioritas P1/P2 benar, tidak menulis apa pun, lembar cek fisik BUTA, --apply ditolak", async () => {
  const hambat = await createTestMaterial({ unit: "SHEET", name: "Busa Rekon Hambat" }); const risiko = await createTestMaterial({ unit: "PCS", name: "PE Rekon Risiko" });
  await seedBalance(risiko.id, 295); await testPrisma.stockMovement.updateMany({ where: { materialId: risiko.id }, data: { createdAt: new Date("2026-09-08T00:00:00Z") } });
  const sebelum = { mov: await testPrisma.stockMovement.count(), adj: await testPrisma.stockAdjustmentRequest.count(), cnt: await testPrisma.stockCount.count(), jurnal: await testPrisma.finJournalEntry.count() };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rekon-cat-"));
  const f = path.join(dir, "stock.csv"); fs.writeFileSync(f, [["x"], HEAD, row(hambat.name, "SHEET", "8", "1", "7"), row(risiko.name, "PCS", "17", "238", "-221")].map((r) => r.join(",")).join("\n"));
  const out = path.join(dir, "o"); const r = cli(["--csv", f, "--db", "--out", out]); assert.equal(r.status, 0, r.stderr + r.stdout);
  const j = JSON.parse(fs.readFileSync(path.join(out, "rekon-catatan-gudang.json"), "utf8"));
  assert.equal(j.bahan.find((x) => x.kode === hambat.code).prioritas, "P1_MENGHAMBAT");
  assert.equal(j.bahan.find((x) => x.kode === risiko.code).prioritas, "P2_RISIKO");
  assert.deepEqual({ mov: await testPrisma.stockMovement.count(), adj: await testPrisma.stockAdjustmentRequest.count(), cnt: await testPrisma.stockCount.count(), jurnal: await testPrisma.finJournalEntry.count() }, sebelum, "tidak ada tulis");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(out, "Lembar-Cek-Fisik-CF-01.xlsx"));
  const teks = []; wb.eachSheet((ws) => ws.eachRow((rw) => rw.eachCell((c) => teks.push(String(c.value?.result ?? c.value ?? "")))));
  assert.ok(teks.some((t) => t.includes(hambat.code))); assert.ok(!teks.some((t) => /295|238|-221/.test(t) && t.trim() === t && /^-?\d+$/.test(t.trim())), "lembar buta: tanpa saldo sistem/catatan");
  for (const flag of ["--apply", "--post", "--ajukan"]) assert.equal(cli(["--csv", f, "--db", flag]).status, 2);
});
