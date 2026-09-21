// KALIBRASI SALDO RIIL Kas & Bank per 21 Sep 2026 10.09 WIB — SATU jurnal koreksi (source SALDO_AWAL) via ledger resmi.
// Aturan & alasan waktu: lihat kepala services/finance/kalibrasiSaldo.js.
//
//   node scripts/kalibrasiSaldoRiil20260921.js           # PRATINJAU (tidak menulis apa pun)
//   KALIBRASI_BACKUP_OK=1 node scripts/kalibrasiSaldoRiil20260921.js --apply
//
// --apply menolak jalan tanpa KALIBRASI_BACKUP_OK=1 (pengaman: backup database WAJIB dibuat lebih dulu — ./scripts/backup-database.sh).
// Aman dijalankan ulang: kunci idempotensi unik di DB → tidak pernah terposting dua kali.

import { prisma } from "../src/db.js";
import { KALIBRASI_20260921 as K, hitungPosisi, hitungKoreksi, postKalibrasi } from "../src/services/finance/kalibrasiSaldo.js";
import { saldoKasBank } from "../src/services/finance/reports.js";
import { toMoney, ZERO } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tanggal = (d) => new Date(d).toISOString().slice(0, 10);

/** Cuplikan jurnal bertanggal buku SESUDAH tanggal cutoff (mis. seluruh 20 Sep) — untuk membuktikan tidak berubah/tidak ganda. */
async function cuplikanSesudah(db) {
  const entri = await db.finJournalEntry.findMany({
    where: { date: { gt: new Date(`${K.tanggalBuku}T00:00:00.000Z`) }, status: { in: ["POSTED", "REVERSED"] } },
    select: { id: true, entryNumber: true, date: true, status: true, lines: { select: { debit: true, credit: true, cashAccountId: true } } },
    orderBy: { entryNumber: "asc" },
  });
  const perRek = new Map();
  for (const e of entri) for (const l of e.lines) {
    if (!l.cashAccountId) continue;
    perRek.set(l.cashAccountId, (perRek.get(l.cashAccountId) ?? ZERO).plus(toMoney(l.debit)).minus(toMoney(l.credit)));
  }
  return { jumlah: entri.length, nomor: entri.map((e) => `${e.entryNumber}:${e.status}`), perRek: Object.fromEntries([...perRek].map(([k, v]) => [k, v.toFixed(2)])) };
}

function cetakPosisi(judul, posisi, koreksi) {
  console.log(`\n${judul}`);
  for (const r of posisi.rekening) {
    const b = koreksi?.baris.find((x) => x.rekeningId === r.id);
    console.log(`  ${r.nama.padEnd(18)} saldo buku pada cutoff ${rp(r.saldoCutoff).padStart(20)}` +
      (b ? `   target ${rp(b.target).padStart(20)}   SELISIH ${rp(b.selisih).padStart(20)}` : `   mutasi sesudah cutoff ${rp(r.mutasiSesudah).padStart(18)}   current ${rp(r.saldoCurrent).padStart(20)}`));
  }
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "PRATINJAU (tidak menulis apa pun)"}`);
  console.log(`Cutoff: ${K.kode}  (instan UTC ${K.cutoff.toISOString()})  •  tanggal buku jurnal koreksi: ${K.tanggalBuku}`);

  const posisi = await hitungPosisi(prisma, K);
  const koreksi = hitungKoreksi(posisi, K);
  const totalBuku = posisi.rekening.reduce((s, r) => s.plus(toMoney(r.saldoCutoff)), ZERO);
  const totalTarget = Object.values(K.target).reduce((s, v) => s.plus(toMoney(v)), ZERO);

  cetakPosisi("1) SALDO BUKU SEBELUM KOREKSI tepat pada cutoff", posisi, koreksi);
  console.log(`  ${"TOTAL".padEnd(18)} saldo buku ${rp(totalBuku.toFixed(2))}   target ${rp(totalTarget.toFixed(2))}   total jurnal koreksi ${rp(koreksi.total)}`);

  console.log("\n2) NET MOVEMENT SESUDAH CUTOFF (tidak ikut selisih; tidak diubah)");
  for (const r of posisi.rekening) console.log(`  ${r.nama.padEnd(18)} ${rp(r.mutasiSesudah).padStart(20)}   (${r.jumlahJurnalSesudah} jurnal, ${r.jumlahBarisSesudah} baris)`);

  const current = await saldoKasBank(prisma);
  console.log("\n3) SALDO CURRENT SAAT INI menurut laporan Kas & Bank (basis: seluruh ledger)");
  let konsisten = true;
  for (const r of posisi.rekening) {
    const c = current.find((x) => x.id === r.id);
    const cocok = c && toMoney(c.saldo).toFixed(2) === r.saldoCurrent;
    if (!cocok) konsisten = false;
    console.log(`  ${r.nama.padEnd(18)} laporan ${rp(c?.saldo ?? 0).padStart(20)}   cutoff+mutasi ${rp(r.saldoCurrent).padStart(20)}   ${cocok ? "OK" : "TIDAK COCOK"}`);
  }
  if (!konsisten && !APPLY) console.log("  (sebelum koreksi: laporan berbasis tanggal buku; selisih kecil di sini wajar bila ada jurnal bertanggal buku hari ini)");

  console.log("\n4) SENSITIVITAS — jurnal bertanggal buku = tanggal cutoff, tetapi diposting SETELAH cutoff (diperlakukan sebagai SESUDAH cutoff)");
  if (posisi.catatMundurTanggalCutoff.length === 0) console.log("  (tidak ada)");
  for (const c of posisi.catatMundurTanggalCutoff) console.log(`  ${c.entryNumber} ${c.status.padEnd(8)} ${c.rekening.padEnd(18)} ${rp(c.net).padStart(18)}  dibuat ${c.dibuatPada}  ${c.keterangan.slice(0, 60)}`);

  const snapSebelum = await cuplikanSesudah(prisma);
  console.log(`\n5) JURNAL BERTANGGAL BUKU SESUDAH ${K.tanggalBuku}: ${snapSebelum.jumlah} jurnal (dicatat untuk pembuktian tidak berubah)`);

  if (!APPLY) { console.log("\nIni PRATINJAU. Backup dulu, lalu: KALIBRASI_BACKUP_OK=1 node scripts/kalibrasiSaldoRiil20260921.js --apply"); return; }
  if (process.env.KALIBRASI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KALIBRASI_BACKUP_OK=1 SETELAH backup database dibuat.");

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi jurnal ini.");
  console.log(`\n>>> POSTING sebagai ${admin.name} (${admin.id}) ...`);
  const hasil = await prisma.$transaction((tx) => postKalibrasi(tx, { konfig: K, userId: admin.id }), { timeout: 60_000, maxWait: 20_000 });
  if (!hasil.created) { console.log(`Tidak ada jurnal baru: ${hasil.alasan}${hasil.entry ? ` (jurnal ${hasil.entry.entryNumber}, id ${hasil.entry.id})` : ""}`); return; }

  const e = await prisma.finJournalEntry.findUnique({ where: { id: hasil.entry.id }, include: { lines: { include: { account: { select: { code: true, name: true } }, cashAccount: { select: { name: true } } }, orderBy: { lineNo: "asc" } } } });
  console.log(`\nJURNAL KOREKSI: ${e.entryNumber}  id ${e.id}  tanggal ${tanggal(e.date)}  source ${e.source}  status ${e.status}\n  "${e.description}"  key ${e.idempotencyKey}`);
  let d = ZERO; let c = ZERO;
  for (const l of e.lines) {
    d = d.plus(toMoney(l.debit)); c = c.plus(toMoney(l.credit));
    console.log(`  ${String(l.lineNo).padStart(2)} ${l.account.code} ${l.account.name.padEnd(22)} ${l.cashAccount?.name?.padEnd(16) ?? "".padEnd(16)} D ${rp(l.debit).padStart(20)}  K ${rp(l.credit).padStart(20)}`);
  }
  console.log(`  Σ debit ${rp(d.toFixed(2))}  Σ kredit ${rp(c.toFixed(2))}  ${d.equals(c) ? "SEIMBANG" : "TIDAK SEIMBANG!"}`);

  const sesudah = await hitungPosisi(prisma, K);
  cetakPosisi("6) SALDO SETELAH KOREKSI (pada cutoff & current)", sesudah, null);
  for (const [nama, target] of Object.entries(K.target)) {
    const r = sesudah.rekening.find((x) => x.nama === nama);
    console.log(`  cek cutoff ${nama.padEnd(18)} ${rp(r.saldoCutoff)} ${toMoney(r.saldoCutoff).equals(toMoney(target)) ? "== target OK" : "≠ TARGET!"}`);
  }
  const current2 = await saldoKasBank(prisma);
  console.log("\n7) SALDO CURRENT (laporan Kas & Bank) = saldo riil cutoff + net movement sesudah cutoff");
  for (const r of sesudah.rekening) {
    const cc = current2.find((x) => x.id === r.id);
    if (!K.target[r.nama]) { console.log(`  ${r.nama.padEnd(18)} tidak dikalibrasi (tidak ada target)  laporan ${rp(cc.saldo)}`); continue; }
    const harapan = toMoney(K.target[r.nama]).plus(toMoney(r.mutasiSesudah)).toFixed(2);
    console.log(`  ${r.nama.padEnd(18)} laporan ${rp(cc.saldo).padStart(20)}   riil ${rp(K.target[r.nama]).padStart(20)} + mutasi ${rp(r.mutasiSesudah).padStart(18)} = ${rp(harapan).padStart(20)}  ${toMoney(cc.saldo).toFixed(2) === harapan ? "OK" : "TIDAK COCOK!"}`);
  }
  console.log(`  TOTAL current ${rp(current2.reduce((s, x) => s.plus(toMoney(x.saldo)), ZERO).toFixed(2))}`);

  const snapSesudah = await cuplikanSesudah(prisma);
  const utuh = JSON.stringify(snapSebelum) === JSON.stringify(snapSesudah);
  console.log(`\n8) JURNAL SESUDAH ${K.tanggalBuku}: sebelum ${snapSebelum.jumlah}, sesudah ${snapSesudah.jumlah} — nomor & mutasi per rekening ${utuh ? "IDENTIK (utuh, tidak ganda)" : "BERBEDA!"}`);

  const ulang = await prisma.$transaction((tx) => postKalibrasi(tx, { konfig: K, userId: admin.id }));
  const jumlahKey = await prisma.finJournalEntry.count({ where: { idempotencyKey: K.idempotencyKey } });
  console.log(`9) Posting ulang: created=${ulang.created} (${ulang.alasan}); jumlah jurnal dengan kunci ini = ${jumlahKey}`);
}

main().catch((e) => { console.error("SCRIPT ERROR:", e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
