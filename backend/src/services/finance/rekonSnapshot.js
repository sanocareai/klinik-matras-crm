// B3 — REKONSILIASI CUTOFF & LATE-POSTING GUARD.
//
// Periode rekonsiliasi = snapshot historis IMMUTABLE. Saldo buku snapshot dihitung SEKALI saat snapshot dibuat dan disimpan
// (fin_recon_snapshots, dijaga trigger DB). Tampilan periode TIDAK menghitung ulang snapshot dari seluruh jurnal; yang dihitung saat
// dibuka hanyalah jurnal SESUDAH high-water mark (sedikit) + saldo buku sekarang, lalu dicek identitasnya:
//     saldo snapshot + Posting Setelah Cutoff + Reversal Setelah Snapshot + Penyesuaian Buku setelah snapshot = Saldo Buku Sekarang
// Kalau identitas itu tidak terpenuhi, jurnal yang sudah termasuk snapshot pasti berubah/hilang → snapshot dianggap TIDAK BERLAKU.
//
// Definisi waktu (lihat komentar model FinReconSnapshot di schema.prisma):
//   tanggal buku (entry.date) ≠ waktu jurnal dibuat (entry.created_at) ≠ cutoff mutasi bank ≠ waktu konfirmasi saldo riil
//   ≠ waktu snapshot dibuat ≠ high-water mark. Jurnal "termasuk snapshot" = tanggal buku <= periodEnd DAN dibuat <= hwmAt.
//
// Modul ini TIDAK PERNAH membuat, mengubah, atau membalik jurnal, dan tidak memperbaiki exception secara otomatis.

import crypto from "node:crypto";
import { toMoney, moneyToNumber } from "./money.js";

export class RekonError extends Error {
  constructor(message, statusCode = 400, code) { super(message); this.statusCode = statusCode; if (code) this.code = code; }
}

const SUMBER_PENYESUAIAN = new Set(["SALDO_AWAL", "REKONSILIASI_SEMENTARA"]);
export const KATEGORI = {
  POSTING_SETELAH_CUTOFF: "Posting Setelah Cutoff",
  REVERSAL_SETELAH_SNAPSHOT: "Reversal Setelah Snapshot",
  PENYESUAIAN_BUKU: "Penyesuaian Buku (bukan mutasi bank) setelah snapshot",
};

const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const asDate = (s) => (s instanceof Date ? s : new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`));

/**
 * Nilai per jurnal pada SATU rekening: hanya baris di akun buku rekening itu sendiri (sama dengan Kas & Bank). Baris lain yang kebetulan
 * ditandai cash_account_id (mis. beban biaya admin transfer) BUKAN mutasi rekening.
 * `dibuat`: { sampai } → created_at <= sampai; { setelah } → created_at > setelah.
 */
export async function jurnalRekening(db, { cashAccountId, sampaiTanggal, dibuat = {} }) {
  const kondisi = [];
  const params = [cashAccountId, asDate(sampaiTanggal)];
  if (dibuat.sampai) { params.push(new Date(dibuat.sampai)); kondisi.push(`AND e.created_at <= $${params.length}::timestamp`); }
  if (dibuat.setelah) { params.push(new Date(dibuat.setelah)); kondisi.push(`AND e.created_at > $${params.length}::timestamp`); }
  const rows = await db.$queryRawUnsafe(
    `SELECT e.id::text AS id, e.entry_number AS nomor, e.date AS tanggal, e.created_at AS dibuat, e.source::text AS sumber, e.status::text AS status,
            e.source_id AS "sourceId", e.reversal_of_id::text AS "reversalOfId", e.description AS keterangan,
            SUM(l.debit - l.credit)::text AS nilai
       FROM fin_journal_lines l
       JOIN fin_cash_accounts c ON c.id = l.cash_account_id AND c.account_id = l.account_id
       JOIN fin_journal_entries e ON e.id = l.entry_id
      WHERE l.cash_account_id = $1::uuid AND e.status IN ('POSTED','REVERSED') AND e.date <= $2::date ${kondisi.join(" ")}
      GROUP BY e.id
      ORDER BY e.created_at, e.entry_number`,
    ...params,
  );
  return rows.map((r) => ({ ...r, nilai: toMoney(r.nilai) }));
}

/** Saldo buku rekening per tanggal buku (semua jurnal yang dihitung, dibuat kapan pun). Definisi sama dengan Kas & Bank. */
export async function saldoBukuRekening(db, cashAccountId, sampaiTanggal) {
  const [r] = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS saldo
       FROM fin_journal_lines l
       JOIN fin_cash_accounts c ON c.id = l.cash_account_id AND c.account_id = l.account_id
       JOIN fin_journal_entries e ON e.id = l.entry_id
      WHERE l.cash_account_id = $1::uuid AND e.status IN ('POSTED','REVERSED') AND e.date <= $2::date`,
    cashAccountId, asDate(sampaiTanggal),
  );
  return toMoney(r?.saldo ?? 0);
}

export function hashJurnal(entries) {
  const isi = entries.map((e) => `${e.id}:${toMoney(e.nilai).toFixed(2)}`).sort().join("\n");
  return crypto.createHash("sha256").update(isi).digest("hex");
}

/** Hitung isi snapshot (murni baca). Dipakai saat MEMBUAT snapshot dan untuk verifikasi integritas eksplisit — bukan saat halaman dibuka. */
export async function hitungIsiSnapshot(db, { cashAccountId, periodStart, periodEnd, hwmAt }) {
  const termasuk = await jurnalRekening(db, { cashAccountId, sampaiTanggal: periodEnd, dibuat: { sampai: hwmAt } });
  const saldo = termasuk.reduce((t, e) => t.plus(e.nilai), toMoney(0));
  const awal = asDate(periodStart).getTime();
  const dalamPeriode = termasuk.filter((e) => new Date(e.tanggal).getTime() >= awal);
  const perSumber = {};
  for (const e of dalamPeriode) {
    const p = perSumber[e.sumber] || { jumlah: 0, nilai: toMoney(0) };
    p.jumlah += 1; p.nilai = p.nilai.plus(e.nilai); perSumber[e.sumber] = p;
  }
  const hwm = termasuk.at(-1) || null;
  return {
    bookBalance: saldo,
    entryCount: termasuk.length,
    entryHash: hashJurnal(termasuk),
    hwmEntry: hwm ? { id: hwm.id, nomor: hwm.nomor, dibuat: hwm.dibuat } : null,
    summary: {
      jurnalDalamPeriode: dalamPeriode.length,
      nilaiDalamPeriode: moneyToNumber(dalamPeriode.reduce((t, e) => t.plus(e.nilai), toMoney(0))),
      perSumber: Object.fromEntries(Object.entries(perSumber).map(([k, v]) => [k, { jumlah: v.jumlah, nilai: moneyToNumber(v.nilai) }])),
      nomorDalamPeriode: dalamPeriode.slice(0, 500).map((e) => e.nomor),
      nomorTerpotong: dalamPeriode.length > 500,
    },
  };
}

/**
 * Buat snapshot SEKALI per periode (idempoten & aman paralel: advisory lock per statement + unique statement_id).
 * Pemanggilan kedua mengembalikan snapshot yang sudah ada tanpa mengubahnya.
 */
export async function buatSnapshot(tx, { statementId, hwmAt, confirmedAt = null, confirmedSource, explanation = null, userId = null }) {
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `REKON_SNAPSHOT:${statementId}`);
  const ada = await tx.finReconSnapshot.findUnique({ where: { statementId } });
  if (ada) return { snapshot: ada, dibuat: false };
  const s = await tx.finBankStatement.findUnique({ where: { id: statementId } });
  if (!s) throw new RekonError("Periode rekonsiliasi tidak ditemukan", 404);
  if (!confirmedSource?.trim()) throw new RekonError("Sumber konfirmasi saldo wajib diisi");
  const sekarang = new Date();
  const hwm = hwmAt ? new Date(hwmAt) : sekarang;
  if (Number.isNaN(hwm.getTime())) throw new RekonError("High-water mark tidak valid");
  if (hwm > sekarang) throw new RekonError("High-water mark tidak boleh di masa depan");
  if (hwmAt && sekarang - hwm > 60_000 && !explanation?.trim()) {
    throw new RekonError("High-water mark di masa lalu wajib disertai penjelasan bukti (mis. waktu pengecekan saldo riil)");
  }
  const isi = await hitungIsiSnapshot(tx, { cashAccountId: s.cashAccountId, periodStart: s.periodStart, periodEnd: s.periodEnd, hwmAt: hwm });
  const snapshot = await tx.finReconSnapshot.create({
    data: {
      statementId, cashAccountId: s.cashAccountId, periodStart: s.periodStart, periodEnd: s.periodEnd,
      openingBank: s.openingBalance, closingBank: s.closingBalance, bookBalance: isi.bookBalance,
      cutoffStartAt: s.cutoffStartAt, cutoffEndAt: s.cutoffEndAt, confirmedAt: confirmedAt ? new Date(confirmedAt) : null,
      confirmedSource: confirmedSource.trim(), snapshotAt: sekarang, hwmAt: hwm,
      hwmEntryId: isi.hwmEntry?.id ?? null, hwmEntryNumber: isi.hwmEntry?.nomor ?? null,
      entryCount: isi.entryCount, entryHash: isi.entryHash, summary: isi.summary, explanation: explanation?.trim() || null, createdById: userId,
    },
  });
  return { snapshot, dibuat: true };
}

/** Jurnal SESUDAH high-water mark yang tanggal bukunya <= periodEnd, dikelompokkan. Tidak menyentuh isi snapshot. */
export async function klasifikasiSetelahSnapshot(db, snap) {
  const setelah = await jurnalRekening(db, { cashAccountId: snap.cashAccountId, sampaiTanggal: snap.periodEnd, dibuat: { setelah: snap.hwmAt } });
  const awal = new Date(snap.periodStart).getTime();
  const item = setelah.map((e) => {
    const kategori = e.sumber === "REVERSAL" || e.reversalOfId ? "REVERSAL_SETELAH_SNAPSHOT"
      : SUMBER_PENYESUAIAN.has(e.sumber) ? "PENYESUAIAN_BUKU" : "POSTING_SETELAH_CUTOFF";
    return {
      jurnalId: e.id, nomor: e.nomor, tanggalBuku: tgl(e.tanggal), dibuatPada: new Date(e.dibuat).toISOString(), sumber: e.sumber,
      sourceId: e.sourceId, membalik: e.reversalOfId, status: e.status, keterangan: e.keterangan,
      kategori, kategoriLabel: KATEGORI[kategori], tanggalSebelumPeriode: new Date(e.tanggal).getTime() < awal, nilai: moneyToNumber(e.nilai),
    };
  });
  const total = (k) => moneyToNumber(item.filter((i) => i.kategori === k).reduce((t, i) => t.plus(toMoney(i.nilai)), toMoney(0)));
  const jumlah = (k) => item.filter((i) => i.kategori === k).length;
  const [luar] = await db.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT e.id)::int AS n FROM fin_journal_lines l
       JOIN fin_cash_accounts c ON c.id = l.cash_account_id AND c.account_id = l.account_id
       JOIN fin_journal_entries e ON e.id = l.entry_id
      WHERE l.cash_account_id = $1::uuid AND e.status IN ('POSTED','REVERSED') AND e.date > $2::date AND e.created_at > $3::timestamp`,
    snap.cashAccountId, asDate(snap.periodEnd), new Date(snap.hwmAt),
  );
  return {
    item,
    ringkasan: Object.fromEntries(Object.keys(KATEGORI).map((k) => [k, { jumlah: jumlah(k), total: total(k) }])),
    totalSetelahSnapshot: moneyToNumber(item.reduce((t, i) => t.plus(toMoney(i.nilai)), toMoney(0))),
    diLuarPeriode: { jumlah: luar?.n ?? 0, catatan: "Jurnal dibuat sesudah snapshot dengan tanggal buku SESUDAH periode — tidak memengaruhi periode ini." },
  };
}

/** Pandangan lengkap satu periode ber-snapshot: angka snapshot tersimpan + jurnal sesudahnya + saldo sekarang + cek identitas. */
export async function pandanganCutoff(db, snap, { closingBank }) {
  const kl = await klasifikasiSetelahSnapshot(db, snap);
  const sekarang = await saldoBukuRekening(db, snap.cashAccountId, snap.periodEnd);
  const snapshotBuku = toMoney(snap.bookBalance);
  const hitungan = snapshotBuku.plus(toMoney(kl.totalSetelahSnapshot));
  const konsisten = hitungan.equals(sekarang);
  const invalid = !!snap.invalidatedAt || !konsisten;
  return {
    snapshot: {
      id: snap.id, snapshotAt: snap.snapshotAt, hwmAt: snap.hwmAt, hwmEntryNumber: snap.hwmEntryNumber, confirmedAt: snap.confirmedAt,
      confirmedSource: snap.confirmedSource, cutoffStartAt: snap.cutoffStartAt, cutoffEndAt: snap.cutoffEndAt, explanation: snap.explanation,
      saldoAwalBank: moneyToNumber(snap.openingBank), saldoAkhirBank: moneyToNumber(snap.closingBank), saldoBuku: moneyToNumber(snapshotBuku),
      selisih: moneyToNumber(toMoney(snap.closingBank).minus(snapshotBuku)), entryCount: snap.entryCount, entryHash: snap.entryHash, ringkasan: snap.summary,
    },
    postingSetelahCutoff: kl.item.filter((i) => i.kategori === "POSTING_SETELAH_CUTOFF"),
    reversalSetelahSnapshot: kl.item.filter((i) => i.kategori === "REVERSAL_SETELAH_SNAPSHOT"),
    penyesuaianSetelahSnapshot: kl.item.filter((i) => i.kategori === "PENYESUAIAN_BUKU"),
    ringkasanSetelahSnapshot: kl.ringkasan,
    diLuarPeriode: kl.diLuarPeriode,
    saldoBukuSekarang: moneyToNumber(sekarang),
    selisihSekarang: moneyToNumber(toMoney(closingBank).minus(sekarang)),
    identitas: { snapshotDitambahSetelah: moneyToNumber(hitungan), saldoBukuSekarang: moneyToNumber(sekarang), konsisten },
    valid: !invalid,
    alasanTidakBerlaku: snap.invalidatedAt ? `Dinyatakan tidak berlaku: ${snap.invalidReason || "-"}`
      : !konsisten ? "Jurnal yang sudah termasuk snapshot berubah atau hilang — angka snapshot tidak lagi bisa dipertanggungjawabkan" : null,
  };
}

/** Verifikasi integritas penuh (eksplisit, bukan saat halaman dibuka): hitung ulang himpunan jurnal <= hwm dan bandingkan hash. */
export async function verifikasiIntegritas(db, snap) {
  const isi = await hitungIsiSnapshot(db, { cashAccountId: snap.cashAccountId, periodStart: snap.periodStart, periodEnd: snap.periodEnd, hwmAt: snap.hwmAt });
  return {
    cocok: isi.entryHash === snap.entryHash && isi.bookBalance.equals(toMoney(snap.bookBalance)) && isi.entryCount === snap.entryCount,
    tersimpan: { hash: snap.entryHash, saldo: moneyToNumber(snap.bookBalance), jumlah: snap.entryCount },
    dihitungUlang: { hash: isi.entryHash, saldo: moneyToNumber(isi.bookBalance), jumlah: isi.entryCount },
  };
}

// ─── EXCEPTION "PERLU DITINJAU" ─────────────────────────────────────────────
// Hanya DETEKSI. Tidak ada perbaikan otomatis. Exception yang sudah ditinjau manusia (fin_recon_exception_reviews) tetap tampil,
// tetapi tidak memblokir penyelesaian periode.
export const LABEL_EXCEPTION = {
  DOKUMEN_AKTIF_JURNAL_DIBALIK: "Dokumen aktif (disetujui/dibayar) tetapi seluruh jurnalnya sudah dibalik",
  DOKUMEN_AKTIF_TANPA_JURNAL: "Dokumen aktif tanpa jurnal",
  JURNAL_AKTIF_TANPA_DOKUMEN: "Jurnal aktif tanpa dokumen aktif (dokumen hilang/dibatalkan)",
  PEMBAYARAN_TIDAK_SINKRON: "Pembayaran dan jurnalnya tidak sinkron",
};

// Dokumen berjurnal yang diperiksa. rekDok = ekspresi rekening dokumen (default kolom cash_account_id).
const DOKUMEN = [
  { sumber: "PENGELUARAN", tabel: "fin_expenses", nomor: "expense_number", aktif: "d.status IN ('DISETUJUI','DIBAYAR')", jenis: "Pengeluaran" },
  { sumber: "PEMBELIAN", tabel: "fin_purchases", nomor: "purchase_number", aktif: "d.status IN ('DISETUJUI','DIBAYAR')", jenis: "Pembelian" },
  { sumber: "TRANSFER_KAS", tabel: "fin_cash_transfers", nomor: "transfer_number", aktif: "d.cancelled_at IS NULL", jenis: "Transfer kas", rekDok: "ARRAY[d.from_account_id::text, d.to_account_id::text]" },
  { sumber: "PEMASUKAN_LAIN", tabel: "fin_other_incomes", nomor: "income_number", aktif: "d.cancelled_at IS NULL", jenis: "Pemasukan lain" },
  { sumber: "PEMBAYARAN_SUPPLIER", tabel: "fin_supplier_payments", nomor: "payment_number", aktif: "d.cancelled_at IS NULL", jenis: "Pembayaran supplier" },
];

export async function daftarException(db, { cashAccountId = null } = {}) {
  const hasil = [];
  const rekeningDariJurnal = `(SELECT array_agg(DISTINCT l.cash_account_id::text) FROM fin_journal_lines l JOIN fin_journal_entries e2 ON e2.id = l.entry_id
                                WHERE e2.source = $SUMBER AND e2.source_id = d.id::text AND l.cash_account_id IS NOT NULL)`;
  for (const d of DOKUMEN) {
    const rek = rekeningDariJurnal.replace("$SUMBER", `'${d.sumber}'`);
    const e1 = await db.$queryRawUnsafe(
      `SELECT d.id::text AS ref, d.${d.nomor} AS nomor, d.date AS tanggal, ${rek} AS rekening,
              (SELECT string_agg(e.entry_number, ', ' ORDER BY e.entry_number) FROM fin_journal_entries e WHERE e.source = '${d.sumber}' AND e.source_id = d.id::text) AS jurnal
         FROM ${d.tabel} d
        WHERE ${d.aktif}
          AND EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = '${d.sumber}' AND e.source_id = d.id::text)
          AND NOT EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = '${d.sumber}' AND e.source_id = d.id::text AND e.status = 'POSTED')`);
    for (const r of e1) hasil.push({ kode: "DOKUMEN_AKTIF_JURNAL_DIBALIK", jenisDokumen: d.jenis, ...r });
    const e2 = await db.$queryRawUnsafe(
      `SELECT d.id::text AS ref, d.${d.nomor} AS nomor, d.date AS tanggal, ${d.rekDok || "ARRAY[d.cash_account_id::text]"} AS rekening, NULL::text AS jurnal
         FROM ${d.tabel} d
        WHERE ${d.aktif} AND NOT EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = '${d.sumber}' AND e.source_id = d.id::text)`);
    for (const r of e2) hasil.push({ kode: "DOKUMEN_AKTIF_TANPA_JURNAL", jenisDokumen: d.jenis, ...r, rekening: (r.rekening || []).filter(Boolean) });
    const e3 = await db.$queryRawUnsafe(
      `SELECT e.id::text AS ref, e.entry_number AS nomor, e.date AS tanggal, e.entry_number AS jurnal,
              (SELECT array_agg(DISTINCT l.cash_account_id::text) FROM fin_journal_lines l WHERE l.entry_id = e.id AND l.cash_account_id IS NOT NULL) AS rekening
         FROM fin_journal_entries e
        WHERE e.source = '${d.sumber}' AND e.status = 'POSTED'
          AND NOT EXISTS (SELECT 1 FROM ${d.tabel} d WHERE d.id::text = e.source_id AND ${d.aktif})`);
    for (const r of e3) hasil.push({ kode: "JURNAL_AKTIF_TANPA_DOKUMEN", jenisDokumen: d.jenis, ...r });
  }
  // Pembayaran order: dibatalkan tapi jurnal masih aktif, atau aktif tapi seluruh jurnalnya dibalik.
  const p = await db.$queryRawUnsafe(
    `SELECT d.id::text AS ref, NULL::text AS nomor, d.created_at AS tanggal, ARRAY[d.cash_account_id::text] AS rekening,
            (SELECT string_agg(e.entry_number, ', ' ORDER BY e.entry_number) FROM fin_journal_entries e WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = d.id::text) AS jurnal,
            CASE WHEN d.cancelled_at IS NOT NULL THEN 'Pembayaran dibatalkan, jurnal masih aktif' ELSE 'Pembayaran aktif, seluruh jurnal sudah dibalik' END AS rincian
       FROM payments d
      WHERE (d.cancelled_at IS NOT NULL AND EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = d.id::text AND e.status = 'POSTED'))
         OR (d.cancelled_at IS NULL AND EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = d.id::text)
             AND NOT EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = d.id::text AND e.status = 'POSTED'))`);
  for (const r of p) hasil.push({ kode: "PEMBAYARAN_TIDAK_SINKRON", jenisDokumen: "Pembayaran order", ...r });

  const tinjau = await db.finReconExceptionReview.findMany({});
  const petaTinjau = new Map(tinjau.map((t) => [`${t.code}:${t.refId}`, t]));
  const nama = new Map((await db.user.findMany({ where: { id: { in: [...new Set(tinjau.map((t) => t.reviewedById).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const items = hasil
    .map((r) => {
      const t = petaTinjau.get(`${r.kode}:${r.ref}`);
      return {
        kode: r.kode, label: LABEL_EXCEPTION[r.kode], jenisDokumen: r.jenisDokumen, refId: r.ref, nomor: r.nomor, tanggal: tgl(r.tanggal),
        jurnal: r.jurnal || null, rincian: r.rincian || null, rekeningIds: (r.rekening || []).filter(Boolean),
        ditinjau: t ? { oleh: nama.get(t.reviewedById) ?? null, pada: t.reviewedAt, catatan: t.note } : null,
      };
    })
    .filter((r) => !cashAccountId || r.rekeningIds.includes(cashAccountId));
  return { items, terbuka: items.filter((i) => !i.ditinjau).length, total: items.length };
}

export async function tinjauException(db, { kode, refId, catatan, userId }) {
  if (!LABEL_EXCEPTION[kode]) throw new RekonError("Kode exception tidak dikenal");
  if (!refId) throw new RekonError("Referensi exception wajib diisi");
  if (!catatan?.trim()) throw new RekonError("Catatan tinjauan wajib diisi — jelaskan kenapa exception ini tidak perlu diperbaiki sekarang");
  const semua = await daftarException(db);
  if (!semua.items.some((i) => i.kode === kode && i.refId === refId)) throw new RekonError("Exception tidak ditemukan atau sudah tidak berlaku", 404);
  return db.finReconExceptionReview.upsert({
    where: { code_refId: { code: kode, refId } },
    create: { code: kode, refId, note: catatan.trim(), reviewedById: userId },
    update: {},
  });
}
