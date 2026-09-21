// SNAPSHOT PILOT FINANCE MOBILE 1.0.0 — READ-ONLY (tidak menulis apa pun ke database).
//
// Jalankan di server:  ssh ubuntu@… "cd ~/klinik-matras && docker compose exec -T backend node --input-type=module -" < backend/scripts/pilot-snapshot.mjs
// Env (opsional):  PILOT_BASELINE=<file JSON snapshot sebelumnya, di dalam container>  →  bandingkan dan rekonsiliasi.
//                  Tanpa itu: cetak snapshot dasar (JSON di baris "SNAPSHOT_JSON=").
//
// Yang diperiksa:
//   1. Neraca seimbang pada tanggal-tanggal kunci dan hari ini.
//   2. Saldo per rekening kas/bank.
//   3. JV-19092026-372 tidak berubah (sidik jari isi + status + updatedAt) dan akun 2-1600 tidak tersentuh sejak baseline.
//   4. Jurnal baru sejak baseline: nomor, sumber, dokumen sumber, status, pembuat.
//   5. Jurnal GANDA: >1 jurnal POSTED/REVERSED-asli dengan (source, sourceId) sama; idempotencyKey ganda.
//   6. Rekonsiliasi saldo: saldo_awal(baseline) + mutasi baris jurnal kas/bank sejak baseline == saldo_sekarang untuk setiap rekening.
//   7. Setiap jurnal baru seimbang (debit == kredit).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "/app/src/db.js";
import { neraca, saldoKasBank } from "/app/src/services/finance/reports.js";

const D = (s) => new Date(`${s}T00:00:00Z`);
const wibHariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const TANGGAL_KUNCI = ["2026-08-31", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", wibHariIni];
const dec = (v) => Number(v ?? 0);
const rp = (n) => Math.round(n * 100) / 100;

const kb = await saldoKasBank(prisma, {});
const daftarKb = kb.rekening ?? kb.accounts ?? kb;
const saldo = Object.fromEntries(daftarKb.map((r) => [r.id ?? r.name, { nama: r.name, saldo: rp(dec(r.saldo)) }]));

const neracaHari = {};
for (const t of [...new Set(TANGGAL_KUNCI)]) {
  const n = await neraca(prisma, { to: D(t) });
  neracaHari[t] = { seimbang: n.ringkasan.seimbang, selisih: dec(n.ringkasan.selisih), aset: dec(n.ringkasan.totalAset) };
}

const jv = await prisma.finJournalEntry.findUnique({ where: { entryNumber: "JV-19092026-372" }, include: { lines: { orderBy: { id: "asc" } } } });
const sidikJari = createHash("sha256").update(JSON.stringify({ status: jv.status, date: jv.date, lines: jv.lines.map((l) => [l.accountId, String(l.debit), String(l.credit)]) })).digest("hex").slice(0, 16);
const j2 = await prisma.finJournalEntry.findMany({ where: { lines: { some: { account: { code: "2-1600" } } } }, select: { entryNumber: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 });

const sekarang = new Date();
const snap = {
  diambilPada: sekarang.toISOString(), neraca: neracaHari, saldo,
  jv372: { status: jv.status, updatedAt: jv.updatedAt?.toISOString?.() ?? null, sidikJari },
  akun2_1600_terakhir: j2[0] ? { nomor: j2[0].entryNumber, dibuat: j2[0].createdAt.toISOString() } : null,
};

const fileBase = process.env.PILOT_BASELINE;
if (!fileBase) {
  console.log(`SNAPSHOT_JSON=${JSON.stringify(snap)}`);
  await prisma.$disconnect();
  process.exit(0);
}

const base = JSON.parse(readFileSync(fileBase, "utf8"));
const sejak = new Date(base.diambilPada);
const laporan = { baseline: base.diambilPada, sekarang: snap.diambilPada, temuan: [] };
const temu = (tingkat, teks) => { laporan.temuan.push({ tingkat, teks }); };

// 1. Neraca
for (const [t, n] of Object.entries(neracaHari)) if (n.seimbang !== true || n.selisih !== 0) temu("P0", `Neraca ${t} TIDAK seimbang (selisih ${n.selisih})`);
// 3. JV-372 & 2-1600
if (base.jv372.sidikJari !== snap.jv372.sidikJari || base.jv372.status !== snap.jv372.status || base.jv372.updatedAt !== snap.jv372.updatedAt) temu("P0", "JV-19092026-372 BERUBAH");
if (JSON.stringify(base.akun2_1600_terakhir) !== JSON.stringify(snap.akun2_1600_terakhir)) temu("P0", "Ada jurnal baru pada akun 2-1600");

// 4. Jurnal baru
const baru = await prisma.finJournalEntry.findMany({
  where: { createdAt: { gt: sejak } }, orderBy: { createdAt: "asc" },
  select: { id: true, entryNumber: true, source: true, sourceId: true, status: true, date: true, createdAt: true, idempotencyKey: true, description: true, createdBy: { select: { name: true } }, lines: { select: { debit: true, credit: true, cashAccountId: true, account: { select: { code: true } } } } },
});
laporan.jurnalBaru = baru.map((j) => ({ nomor: j.entryNumber, sumber: j.source, sumberId: j.sourceId, status: j.status, tanggalBuku: j.date.toISOString().slice(0, 10), dibuat: j.createdAt.toISOString(), pembuat: j.createdBy?.name ?? null, keterangan: (j.description ?? "").slice(0, 80) }));

// 7. Seimbang per jurnal
for (const j of baru) {
  const d = j.lines.reduce((s, l) => s + dec(l.debit), 0);
  const k = j.lines.reduce((s, l) => s + dec(l.credit), 0);
  if (rp(d - k) !== 0) temu("P0", `Jurnal ${j.entryNumber} tidak seimbang (${rp(d - k)})`);
}

// 5. Ganda
const kelompok = new Map();
for (const j of baru) {
  if (!j.sourceId || j.source === "REVERSAL") continue;
  const kunci = `${j.source}:${j.sourceId}:${j.idempotencyKey ?? ""}`;
  kelompok.set(kunci, [...(kelompok.get(kunci) ?? []), j.entryNumber]);
}
for (const [k, v] of kelompok) if (v.length > 1) temu("P0", `Jurnal ganda untuk ${k}: ${v.join(", ")}`);
const kunciIdem = new Map();
for (const j of baru) if (j.idempotencyKey) kunciIdem.set(j.idempotencyKey, [...(kunciIdem.get(j.idempotencyKey) ?? []), j.entryNumber]);
for (const [k, v] of kunciIdem) if (v.length > 1) temu("P0", `idempotencyKey ganda ${k}: ${v.join(", ")}`);

// 6. Rekonsiliasi saldo per rekening
const mutasi = {};
for (const j of baru) for (const l of j.lines) if (l.cashAccountId) mutasi[l.cashAccountId] = rp((mutasi[l.cashAccountId] ?? 0) + dec(l.debit) - dec(l.credit));
laporan.rekonsiliasi = Object.entries(saldo).map(([id, s]) => {
  const awal = base.saldo[id]?.saldo ?? 0;
  const mut = mutasi[id] ?? 0;
  const seharusnya = rp(awal + mut);
  const selisih = rp(s.saldo - seharusnya);
  if (selisih !== 0) temu("P0", `Saldo ${s.nama} berubah tanpa jurnal resmi: selisih ${selisih}`);
  return { rekening: s.nama, saldoAwal: awal, mutasiJurnal: mut, saldoSeharusnya: seharusnya, saldoSekarang: s.saldo, selisih };
});
laporan.hasil = laporan.temuan.some((t) => t.tingkat === "P0") ? "GAGAL" : "LULUS";
console.log(`LAPORAN_JSON=${JSON.stringify(laporan, null, 1)}`);
await prisma.$disconnect();
