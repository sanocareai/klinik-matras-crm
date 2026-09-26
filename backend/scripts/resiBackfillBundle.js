#!/usr/bin/env node
// Resi Gabungan Fase 2 — dry-run (BACA-SAJA) & backfill metadata-only untuk invoice bundle lama. Metodologi: docs/RESI-GABUNGAN-FASE2.md
//
//   node scripts/resiBackfillBundle.js --cetak-sql [--pra-migrasi]       # cetak SQL baca-saja (untuk psql read-only; --pra-migrasi bila order_groups belum ada)
//   node scripts/resiBackfillBundle.js --dari-json=anggota.json --out=D:\privat\dryrun.json
//                                                                          # klasifikasi dari keluaran psql (mis. produksi), tanpa koneksi DB
//   node scripts/resiBackfillBundle.js --out=D:\privat\dryrun.json         # klasifikasi lewat DATABASE_URL (baca-saja)
//   RESI_BACKFILL_APPLY=YA node scripts/resiBackfillBundle.js --apply [--sertakan-peringatan]   # TULIS (hanya via DATABASE_URL)
//
// stdout hanya berisi AGREGAT (jumlah per klasifikasi/alasan). Rincian per bundle (nomor order/invoice) hanya ke --out, dan --out DITOLAK
// bila berada di dalam repo Git ini — rincian itu privat, tidak boleh ikut ter-commit.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { SQL_ANGGOTA_BUNDLE, SQL_ANGGOTA_BUNDLE_PRA_MIGRASI, klasifikasiSemua, agregatKlasifikasi, terapkanBackfill } from "../src/services/resiBackfill.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function tolakDalamRepo(p) {
  const abs = path.resolve(p);
  if (abs === repoRoot || abs.startsWith(repoRoot + path.sep)) throw new Error(`--out berada di dalam repo (${repoRoot}); rincian privat harus disimpan di luar Git`);
  return abs;
}

function bacaJsonPsql(berkas) {
  const teks = fs.readFileSync(berkas, "utf8");
  const baris = teks.split(/\r?\n/).find((l) => l.trimStart().startsWith("["));
  if (!baris) throw new Error("Tidak menemukan baris JSON dalam berkas (harus keluaran psql dari SQL --cetak-sql)");
  return JSON.parse(baris.trim());
}

async function main() {
  if (args["cetak-sql"]) { console.log((args["pra-migrasi"] ? SQL_ANGGOTA_BUNDLE_PRA_MIGRASI : SQL_ANGGOTA_BUNDLE) + ";"); return; }
  const apply = Boolean(args.apply);
  if (apply && args["dari-json"]) throw new Error("--apply tidak boleh dikombinasikan dengan --dari-json");
  if (apply && process.env.RESI_BACKFILL_APPLY !== "YA") throw new Error("--apply membutuhkan env RESI_BACKFILL_APPLY=YA (izin eksplisit)");
  const out = args.out ? tolakDalamRepo(args.out) : null;

  let baris; let db = null;
  if (args["dari-json"]) baris = bacaJsonPsql(args["dari-json"]);
  else {
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient();
    const r = await db.$queryRawUnsafe(SQL_ANGGOTA_BUNDLE);
    baris = r[0].anggota;
  }

  const hasil = klasifikasiSemua(baris);
  const agregat = agregatKlasifikasi(hasil);
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY-RUN (baca-saja)", ...agregat }, null, 2));

  if (out) {
    const rinci = hasil.map(({ _anggota, ...h }) => ({ ...h, orders: _anggota.map((a) => ({ nomorOrder: a.nomor_order, nomorInvoice: a.nomor_invoice, anchor: a.is_root, status: a.status, statusBayar: a.status_bayar, harga: a.harga, ongkir: a.ongkir, dpTarget: a.dp_target, payments: a.payments })) }));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ dibuatPada: new Date().toISOString(), agregat, bundle: rinci }, null, 2));
    console.log(`Rincian privat ditulis ke: ${out}`);
  }

  if (apply) {
    const r = await terapkanBackfill(db, hasil, { sertakanPeringatan: Boolean(args["sertakan-peringatan"]), jalankanId: new Date().toISOString() });
    console.log(JSON.stringify({ apply: r }, null, 2));
  }
  if (db) await db.$disconnect();
}

main().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
