#!/usr/bin/env node
// Aktivasi unit order nyata untuk Rencana Produksi = menambah unit ke cohort `production_v2_reader` DAN `production_v2_writer` (config.unitIds). KEPUTUSAN OWNER — skrip ini TIDAK
// pernah berjalan otomatis (bukan bagian rilis/migration) dan tidak menyalakan flag yang MATI.
//
//   node scripts/production-delivery-v2/activate-rencana-units.js                              # daftar eligible + pengecualian (BACA-SAJA)
//   node scripts/production-delivery-v2/activate-rencana-units.js --unit-codes=U-1,U-2         # DRY-RUN: tampilkan perubahan cohort yang akan terjadi
//   RENCANA_BACKUP_OK=1 node scripts/production-delivery-v2/activate-rencana-units.js --unit-codes=U-1,U-2 --apply
//   RENCANA_BACKUP_OK=1 node scripts/production-delivery-v2/activate-rencana-units.js --all-eligible --max=20 --apply
//   RENCANA_BACKUP_OK=1 node scripts/production-delivery-v2/activate-rencana-units.js --unit-codes=U-1 --deactivate --apply   # batal (hanya unit TANPA Run aktif)
//
// Pengaman: (1) tanpa --apply tidak menulis apa pun; (2) --apply wajib RENCANA_BACKUP_OK=1 (backup DB sudah ada); (3) hanya unit ELIGIBLE (lihat classifyRencanaUnit) — unit
// pengecualian (V1 progress, Siap Kirim/Terkirim, bukan Diproses, internal/spam, dibatalkan) ditolak dengan alasannya; (4) kedua flag harus SUDAH ON dengan cohort sah — flag
// MATI/cohort rusak = berhenti (menyalakan flag adalah keputusan terpisah); (5) maksimum --max (bawaan 25) unit per eksekusi; (6) satu transaksi dengan kunci baris flag;
// reader & writer selalu berubah BERSAMA; (7) cohort lama dipertahankan utuh (hanya penambahan) dan dicetak sebelum/sesudah untuk rollback.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { V2_FLAGS, loadV2Flags } from "../../src/services/v2FeatureFlags.js";
import { cohortStatesOf, listRencanaEligibility } from "../../src/services/productionRencanaService.js";
import { RENCANA_ACTION } from "../../src/lib/domain/productionRencana.js";

const arg = (name) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name) => { const a = arg(name); return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : null; };
const APPLY = !!arg("apply"); const DEACTIVATE = !!arg("deactivate"); const ALL = !!arg("all-eligible");
const MAX = Number(val("max") || 25);
const prisma = new PrismaClient();
const out = (o) => console.log(JSON.stringify(o, null, 2));
const die = (message, extra = {}) => { out({ ok: false, error: message, ...extra }); process.exitCode = 1; };

async function main() {
  const flags = await loadV2Flags(prisma);
  const states = cohortStatesOf(flags);
  const eligibility = await listRencanaEligibility(prisma, { limit: 2000 });
  const wantedCodes = (val("unit-codes") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const wantedIds = (val("unit-ids") || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

  if (!wantedCodes.length && !wantedIds.length && !ALL) {
    out({ ok: true, mode: "DAFTAR (baca-saja)", cohort: eligibility.cohort, summary: eligibility.summary, units: eligibility.units.map((u) => ({ unitCode: u.unitCode, orderNumber: u.orderNumber, customerName: u.customerName, action: u.action, code: u.code, message: u.message })),
      petunjuk: "Pilih unit dengan --unit-codes=... atau --all-eligible, lalu tambahkan --apply (dengan RENCANA_BACKUP_OK=1)." });
    return;
  }

  const byId = new Map(eligibility.units.map((u) => [u.unitId, u]));
  const picked = ALL ? eligibility.units.filter((u) => u.action === RENCANA_ACTION.AWAIT_ACTIVATION)
    : eligibility.units.filter((u) => wantedCodes.includes(u.unitCode) || wantedIds.includes(u.unitId));
  const unknown = [...wantedCodes.filter((c) => !picked.some((u) => u.unitCode === c)), ...wantedIds.filter((i) => !byId.has(i))];
  if (unknown.length) return die("Unit tidak ditemukan di daftar kandidat (Diproses/Pengambilan, bukan SPAM/staf)", { unknown });
  if (!picked.length) return die("Tidak ada unit yang dipilih/eligible");
  if (picked.length > MAX) return die(`Memilih ${picked.length} unit melebihi --max=${MAX}; kecilkan pilihan atau naikkan --max secara sadar`);

  const rejected = DEACTIVATE
    ? picked.filter((u) => u.hasRun).map((u) => ({ unitCode: u.unitCode, reason: "Unit sudah punya Run aktif — tidak boleh dikeluarkan dari cohort (Run akan yatim)" }))
    : picked.filter((u) => u.action !== RENCANA_ACTION.AWAIT_ACTIVATION && !(u.action === RENCANA_ACTION.EXCEPTION && u.code === "PARTIAL_ACTIVATION" && !u.hasRun))
      .map((u) => ({ unitCode: u.unitCode, reason: `${u.code || u.action}: ${u.message}` }));
  if (rejected.length) return die("Ada unit yang tidak boleh diproses", { rejected });

  for (const [label, s, key] of [["reader", states.reader, V2_FLAGS.PRODUCTION_READER], ["writer", states.writer, V2_FLAGS.PRODUCTION_WRITER]]) {
    if (!flags[key]?.enabled || s.mode !== "COHORT") return die(`Flag ${label} (${key}) tidak ON dengan cohort sah (${s.diagnostic || "OFF"}) — menyalakan flag adalah keputusan terpisah; berhenti`);
  }
  const ids = picked.map((u) => u.unitId);
  const plan = (current) => {
    const set = new Set(current.map((x) => String(x).toLowerCase()));
    for (const id of ids) DEACTIVATE ? set.delete(id) : set.add(id);
    if (set.size === 0) throw new Error("Cohort tidak boleh menjadi kosong");
    return [...set].sort();
  };
  const before = { reader: [...states.reader.unitIds].sort(), writer: [...states.writer.unitIds].sort() };
  const after = { reader: plan(before.reader), writer: plan(before.writer) };
  const preview = { ok: true, mode: APPLY ? "APPLY" : "DRY-RUN (tidak menulis apa pun)", operasi: DEACTIVATE ? "KELUARKAN dari cohort" : "TAMBAH ke cohort", units: picked.map((u) => ({ unitCode: u.unitCode, orderNumber: u.orderNumber, customerName: u.customerName })),
    cohortSebelum: { reader: before.reader.length, writer: before.writer.length }, cohortSesudah: { reader: after.reader.length, writer: after.writer.length } };
  if (!APPLY) { out({ ...preview, petunjuk: "Tambahkan --apply (dengan RENCANA_BACKUP_OK=1) untuk menerapkan." }); return; }
  if (process.env.RENCANA_BACKUP_OK !== "1") return die("Backup database belum dikonfirmasi: jalankan lagi dengan RENCANA_BACKUP_OK=1 setelah backup");

  const reason = `Aktivasi Rencana Produksi: ${DEACTIVATE ? "-" : "+"}${ids.length} unit (activate-rencana-units, ${new Date().toISOString()})`;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT key FROM v2_feature_flags WHERE key IN ($1, $2) ORDER BY key FOR UPDATE`, V2_FLAGS.PRODUCTION_READER, V2_FLAGS.PRODUCTION_WRITER);
    const fresh = cohortStatesOf(await loadV2Flags(tx)); // baca ULANG setelah kunci: cohort bisa berubah sejak dry-run
    const nowReader = [...fresh.reader.unitIds].sort(); const nowWriter = [...fresh.writer.unitIds].sort();
    if (JSON.stringify(nowReader) !== JSON.stringify(before.reader) || JSON.stringify(nowWriter) !== JSON.stringify(before.writer)) throw new Error("Cohort berubah sejak dibaca — jalankan ulang dry-run");
    for (const [key, list] of [[V2_FLAGS.PRODUCTION_READER, after.reader], [V2_FLAGS.PRODUCTION_WRITER, after.writer]]) {
      const row = await tx.v2FeatureFlag.findUniqueOrThrow({ where: { key } });
      await tx.v2FeatureFlag.update({ where: { key }, data: { config: { ...(row.config || {}), unitIds: list }, reason } });
    }
  });
  out({ ...preview, mode: "APPLIED", reason, rollback: { catatan: "Kembalikan dengan --deactivate (unit tanpa Run) atau pulihkan config.unitIds ke daftar berikut", cohortSebelum: before } });
}

main().catch((e) => { out({ ok: false, error: e.message }); process.exitCode = 1; }).finally(() => prisma.$disconnect());
