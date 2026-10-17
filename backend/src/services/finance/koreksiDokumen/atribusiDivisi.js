// KEPUTUSAN ATRIBUSI DIVISI PER DOKUMEN (Okt 2026) — menyelesaikan KONFLIK BUKTI di Beban per Divisi / Laporan Divisi.
//
// Konflik = dokumen biaya yang buktinya menunjuk lebih dari satu divisi (divisi tertulis di dokumen ≠ pemetaan kategori). Laporan tetap memakai aturan prioritas; di sini manusia
// (Finance Admin/Owner) MEMUTUSKAN divisi yang benar PER DOKUMEN, dengan alasan, dan riwayat sebelum/sesudah tersimpan (tabel fin_attribution_decisions, append-only: keputusan baru
// mencabut yang lama, tidak menimpa).
//
// YANG TIDAK DILAKUKAN: tidak membuat/membalik jurnal, tidak mengubah dokumen sumber, tidak mengubah total beban — hanya mengubah divisi mana yang dipilih saat bukti bertentangan.
// Keputusan hanya sah bila (a) dokumen benar-benar bertentangan, (b) scope termasuk kandidat konflik, (c) tidak ada jurnal dokumen itu di periode TERTUTUP.
// Tidak ada keputusan massal: satu dokumen satu permintaan.

import { STATUS_DIHITUNG } from "../journal.js";
import { toMoney, sumMoney, moneyToNumber } from "../money.js";
import { atribusiPengeluaran, atribusiPembelian, SELEKTOR } from "../laporanDivisi/atribusi.js";
import { DARI_FIN_DIVISION, KATEGORI_PEMBELIAN_DIVISI, LABEL_DIVISI } from "../laporanDivisi/divisi.js";
import { muatBarisLabaRugi } from "../laporanTerinci/baris.js";
import { KoreksiError } from "../koreksiGate.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";

export const MODUL_DIDUKUNG = Object.freeze({
  pengeluaran: { sumber: "PENGELUARAN", entitas: ENTITY_TYPES.FIN_EXPENSE, label: "Pengeluaran" },
  pembelian: { sumber: "PEMBELIAN", entitas: ENTITY_TYPES.FIN_PURCHASE, label: "Pembelian" },
});
const rp = (d) => moneyToNumber(d);
const label = (s) => LABEL_DIVISI[s] ?? s;
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tgl = (d) => new Date(d).toISOString().slice(0, 10);

function cekModul(modul) {
  if (!MODUL_DIDUKUNG[modul]) throw new KoreksiError(`Jenis dokumen tidak dikenal untuk keputusan atribusi: ${modul}. Didukung: ${Object.keys(MODUL_DIDUKUNG).join(", ")}`, 400, "MODUL_TIDAK_DIDUKUNG");
}
function cekId(id) {
  if (!POLA_UUID.test(String(id || ""))) throw new KoreksiError("ID dokumen tidak valid", 400, "ID_TIDAK_VALID");
}

/** Dokumen sumber + atribusi TANPA keputusan (aturan prioritas murni) → kandidat konflik & daftar bukti. */
async function muatDokumen(db, modul, id) {
  if (modul === "pengeluaran") {
    const d = await db.finExpense.findUnique({ where: { id }, select: { ...SELEKTOR.SEL_EXP, description: true } });
    if (!d) return null;
    const a = atribusiPengeluaran({ ...d, keputusanAtribusi: null });
    const bukti = [];
    if (d.division && d.division !== "UMUM") bukti.push({ sumber: "Divisi tertulis pada dokumen", scope: DARI_FIN_DIVISION[d.division] ?? null, mentah: d.division });
    if (d.submission?.division) bukti.push({ sumber: `Pengajuan biaya ${d.submission.submissionNumber ?? ""} (workspace pemohon)`, scope: DARI_FIN_DIVISION[d.submission.division] ?? null, mentah: d.submission.division });
    if (d.category?.division) bukti.push({ sumber: `Kategori ${d.category.code} — ${d.category.name}`, scope: DARI_FIN_DIVISION[d.category.division] ?? null, mentah: d.category.division });
    return { nomor: d.expenseNumber, status: d.status, deskripsi: d.description ?? null, atribusi: a, bukti };
  }
  const d = await db.finPurchase.findUnique({ where: { id }, select: { ...SELEKTOR.SEL_BELI, description: true } });
  if (!d) return null;
  const a = atribusiPembelian({ ...d, keputusanAtribusi: null });
  const bukti = [];
  if (d.division && d.division !== "UMUM") bukti.push({ sumber: "Divisi tertulis pada dokumen", scope: DARI_FIN_DIVISION[d.division] ?? null, mentah: d.division });
  const kat = KATEGORI_PEMBELIAN_DIVISI[d.category?.code];
  if (kat) bukti.push({ sumber: `Kategori pembelian ${d.category.code} — ${d.category.name}`, scope: kat, mentah: d.category.code });
  return { nomor: d.purchaseNumber, status: d.status, deskripsi: d.description ?? null, atribusi: a, bukti };
}

/** Jurnal dokumen (asli + pembaliknya) pada akun beban: nilai bersih, daftar, dan tanggal. */
async function jurnalBebanDokumen(db, modul, id) {
  const sumber = MODUL_DIDUKUNG[modul].sumber;
  const asli = await db.finJournalEntry.findMany({ where: { source: sumber, sourceId: id, status: { in: STATUS_DIHITUNG } }, select: { id: true, entryNumber: true, date: true, status: true } });
  const ids = asli.map((e) => e.id);
  const balik = ids.length ? await db.finJournalEntry.findMany({ where: { reversalOfId: { in: ids }, status: { in: STATUS_DIHITUNG } }, select: { id: true, entryNumber: true, date: true, status: true } }) : [];
  const semua = [...asli, ...balik];
  const baris = semua.length ? await db.finJournalLine.findMany({
    where: { entryId: { in: semua.map((e) => e.id) }, account: { type: { in: ["BEBAN", "BEBAN_POKOK"] } } },
    select: { debit: true, credit: true },
  }) : [];
  const nilai = sumMoney(baris.map((l) => toMoney(l.debit || 0).minus(toMoney(l.credit || 0))));
  return { entries: semua.map((e) => ({ nomor: e.entryNumber, tanggal: tgl(e.date), status: e.status })), tanggal: semua.map((e) => tgl(e.date)), nilai: rp(nilai) };
}

async function periodeTertutup(db, tanggalList) {
  const pasang = [...new Set(tanggalList.map((t) => t.slice(0, 7)))].map((s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) }));
  if (!pasang.length) return [];
  const rows = await db.finPeriod.findMany({ where: { status: "CLOSED", OR: pasang }, select: { year: true, month: true } });
  return rows.map((r) => `${String(r.month).padStart(2, "0")}/${r.year}`);
}

const bentukKeputusan = (k) => k && ({
  id: k.id, scope: k.decidedScope, scopeLabel: label(k.decidedScope), sebelum: k.previousScope, sebelumLabel: label(k.previousScope), kandidat: k.candidates, alasan: k.reason,
  olehId: k.decidedById, oleh: k.decidedBy?.name ?? null, pada: k.decidedAt, dicabutPada: k.revokedAt ?? null, dicabutOleh: k.revokedBy?.name ?? null, alasanPencabutan: k.revokeReason ?? null,
});

export async function riwayatKeputusan(db, modul, documentId) {
  cekModul(modul); cekId(documentId);
  const rows = await db.finAttributionDecision.findMany({
    where: { module: modul, documentId }, orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    include: { decidedBy: { select: { name: true } }, revokedBy: { select: { name: true } } },
  });
  return rows.map(bentukKeputusan);
}

/**
 * DAFTAR keputusan atribusi untuk satu periode: dokumen yang MENUNGGU keputusan (bukti bertentangan) dan yang SUDAH diputuskan, satu baris per dokumen.
 * Memakai baris Laba Rugi yang sama dengan kartu/drilldown (satu snapshot) — jadi jumlah & nilai di sini cocok dengan "Konflik atribusi" di laporan.
 */
export async function daftarAtribusi(db, { fromStr, toStr }) {
  const from = new Date(`${fromStr}T00:00:00.000Z`); const to = new Date(`${toStr}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr || "") || !/^\d{4}-\d{2}-\d{2}$/.test(toStr || "") || fromStr > toStr) throw new KoreksiError("Periode tidak valid (YYYY-MM-DD)", 400, "PERIODE_TIDAK_VALID");
  const baris = await muatBarisLabaRugi(db, { from, to, bolehSensitif: true });
  const beban = baris.filter((r) => r.akunTipe === "BEBAN" || r.akunTipe === "BEBAN_POKOK");
  const grup = new Map();
  for (const r of beban) {
    if (!(r.konflik.length > 0 || r.keputusan)) continue;
    const key = r.dokumenId ? `${r.dokumen?.modul}:${r.dokumenId}` : `tanpa:${r.nomorJurnal}`;
    const g = grup.get(key) ?? { modul: r.dokumen?.modul ?? null, dokumenId: r.dokumenId ?? null, nomor: r.dokumen?.nomor ?? null, rows: [] };
    g.rows.push(r); grup.set(key, g);
  }
  const daftar = [];
  for (const g of grup.values()) {
    const didukung = !!MODUL_DIDUKUNG[g.modul] && !!g.dokumenId;
    const nilai = rp(sumMoney(g.rows.map((r) => toMoney(r.nilai))));
    const k = g.rows.find((r) => r.keputusan)?.keputusan ?? null;
    const detail = didukung ? await riwayatKeputusan(db, g.modul, g.dokumenId) : [];
    const aktif = detail.find((x) => !x.dicabutPada) ?? null;
    const kandidat = [...new Set(g.rows.flatMap((r) => r.konflik))];
    if (!kandidat.length && aktif?.kandidat) kandidat.push(...aktif.kandidat);
    daftar.push({
      modul: g.modul, dokumenId: g.dokumenId, nomor: g.nomor, bisaDiputuskan: didukung,
      alasanTidakBisa: didukung ? null : "Jenis dokumen ini belum mendukung keputusan atribusi (hanya Pengeluaran dan Pembelian).",
      status: k ? "DIPUTUSKAN" : "MENUNGGU_KEPUTUSAN",
      kandidat: kandidat.map((s) => ({ scope: s, label: label(s) })),
      divisiSaatIni: g.rows[0].divisi, divisiSaatIniLabel: g.rows[0].divisiLabel,
      nilai, jumlahBaris: g.rows.length, jurnal: [...new Set(g.rows.map((r) => r.nomorJurnal))], tanggal: g.rows.map((r) => r.tanggal).sort()[0],
      deskripsi: g.rows[0].deskripsi, akun: [...new Set(g.rows.map((r) => `${r.akunKode} ${r.akunNama}`))],
      keputusan: aktif, jumlahRiwayat: detail.length,
    });
  }
  daftar.sort((a, b) => (a.status === b.status ? 0 : a.status === "MENUNGGU_KEPUTUSAN" ? -1 : 1) || String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.nomor).localeCompare(String(b.nomor)));
  const menunggu = daftar.filter((d) => d.status === "MENUNGGU_KEPUTUSAN");
  return {
    periode: { from: fromStr, to: toStr },
    ringkasan: {
      menunggu: menunggu.length, diputuskan: daftar.length - menunggu.length, nilaiMenunggu: rp(sumMoney(menunggu.map((d) => toMoney(d.nilai)))),
      barisKonflikLaporan: beban.filter((r) => r.konflik.length > 0).length, nilaiBarisKonflikLaporan: rp(sumMoney(beban.filter((r) => r.konflik.length > 0).map((r) => toMoney(r.nilai)))),
    },
    daftar,
    catatan: "Keputusan hanya memilih divisi saat bukti bertentangan. Tidak membuat jurnal, tidak mengubah dokumen, tidak mengubah total beban.",
  };
}

/** PRATINJAU keputusan (baca-saja): divisi sebelum/sesudah, bukti, jurnal dokumen, dan alasan bila ditolak. */
export async function pratinjauKeputusan(db, { modul, documentId, scope = null }) {
  cekModul(modul); cekId(documentId);
  const dok = await muatDokumen(db, modul, documentId);
  if (!dok) throw new KoreksiError("Dokumen tidak ditemukan", 404, "DOKUMEN_TIDAK_ADA");
  const kandidat = dok.atribusi.konflik ?? [];
  const jurnal = await jurnalBebanDokumen(db, modul, documentId);
  const tertutup = await periodeTertutup(db, jurnal.tanggal);
  const aktif = (await riwayatKeputusan(db, modul, documentId)).find((x) => !x.dicabutPada) ?? null;
  const tahan = [];
  if (kandidat.length < 2) tahan.push({ kode: "TIDAK_ADA_KONFLIK", pesan: "Bukti dokumen ini tidak bertentangan — tidak ada yang perlu diputuskan." });
  if (jurnal.entries.length === 0) tahan.push({ kode: "TANPA_JURNAL", pesan: "Dokumen belum punya jurnal beban di buku besar — keputusan atribusi tidak berpengaruh ke laporan." });
  if (tertutup.length) tahan.push({ kode: "PERIODE_TERTUTUP", pesan: `Jurnal dokumen berada di periode yang sudah ditutup (${tertutup.join(", ")}). Buka periode lebih dulu bila memang harus diubah.` });
  if (scope && !kandidat.includes(scope)) tahan.push({ kode: "SCOPE_BUKAN_KANDIDAT", pesan: `Divisi ${scope} bukan salah satu kandidat bukti (${kandidat.join(", ") || "-"}).` });
  const sebelumScope = aktif ? aktif.scope : dok.atribusi.bagian?.[0]?.scope ?? null;
  return {
    modul, dokumenId: documentId, nomor: dok.nomor, statusDokumen: dok.status, deskripsi: dok.deskripsi,
    bukti: dok.bukti.map((b) => ({ ...b, scopeLabel: b.scope ? label(b.scope) : null })),
    kandidat: kandidat.map((s) => ({ scope: s, label: label(s) })),
    aturanPrioritas: { scope: kandidat.length ? dok.atribusi.bagian[0].scope : null, label: label(dok.atribusi.bagian[0].scope), aturan: dok.atribusi.aturan },
    keputusanAktif: aktif,
    sebelum: { scope: sebelumScope, label: label(sebelumScope) },
    sesudah: scope && kandidat.includes(scope) ? { scope, label: label(scope) } : null,
    dampak: scope && kandidat.includes(scope)
      ? { nilaiBeban: jurnal.nilai, dariDivisi: label(sebelumScope), keDivisi: label(scope), catatan: "Hanya memindahkan atribusi nilai beban dokumen ini antar divisi di laporan. Total beban, jurnal, dan saldo TIDAK berubah." }
      : null,
    jurnal: jurnal.entries, nilaiBebanDokumen: jurnal.nilai,
    tahan, bisaDiputuskan: tahan.length === 0,
  };
}

/** Putuskan atribusi satu dokumen. Idempoten: keputusan aktif yang sama dengan scope yang diminta → tidak ada perubahan. Menggantikan keputusan lain dengan MENCABUT yang lama. */
export async function putuskanAtribusi(tx, { modul, documentId, scope, alasan, userId }) {
  cekModul(modul); cekId(documentId);
  const teks = String(alasan ?? "").trim();
  if (teks.length < 10) throw new KoreksiError("Alasan keputusan wajib diisi (minimal 10 karakter) — menjelaskan bukti yang membuat divisi ini benar.", 400, "ALASAN_WAJIB");
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `keputusan_atribusi:${modul}:${documentId}`);
  const p = await pratinjauKeputusan(tx, { modul, documentId, scope });
  const blok = p.tahan.find((t) => t.kode !== "SCOPE_BUKAN_KANDIDAT") ?? p.tahan.find((t) => t.kode === "SCOPE_BUKAN_KANDIDAT");
  if (blok) throw new KoreksiError(blok.pesan, blok.kode === "PERIODE_TERTUTUP" ? 409 : 422, blok.kode);
  const aktif = await tx.finAttributionDecision.findFirst({ where: { module: modul, documentId, revokedAt: null } });
  if (aktif && aktif.decidedScope === scope) return { dibuat: false, status: "SUDAH_DIPUTUSKAN", keputusanId: aktif.id };
  if (aktif) {
    await tx.finAttributionDecision.update({ where: { id: aktif.id }, data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: `Digantikan keputusan baru (${scope}): ${teks}`.slice(0, 500) } });
  }
  const baru = await tx.finAttributionDecision.create({
    data: {
      module: modul, documentId, documentNumber: p.nomor ?? null, decidedScope: scope, previousScope: aktif ? aktif.decidedScope : p.aturanPrioritas.scope,
      candidates: p.kandidat.map((k) => k.scope), reason: teks, decidedById: userId ?? null,
    },
  });
  await recordActivity(tx, {
    entityType: MODUL_DIDUKUNG[modul].entitas, entityId: documentId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId ?? null,
    metadata: { aksi: "KEPUTUSAN_ATRIBUSI_DIVISI", nomor: p.nomor, before: { divisi: aktif ? aktif.decidedScope : p.aturanPrioritas.scope }, after: { divisi: scope }, kandidat: p.kandidat.map((k) => k.scope), alasan: teks, keputusanId: baru.id, menggantikan: aktif?.id ?? null, nilaiBeban: p.nilaiBebanDokumen },
  });
  return { dibuat: true, status: aktif ? "DIGANTI" : "DIPUTUSKAN", keputusanId: baru.id, menggantikan: aktif?.id ?? null };
}

/** Cabut keputusan aktif — laporan kembali ke aturan prioritas dan konflik muncul lagi. Riwayat tetap. */
export async function cabutKeputusan(tx, { modul, documentId, alasan, userId }) {
  cekModul(modul); cekId(documentId);
  const teks = String(alasan ?? "").trim();
  if (teks.length < 10) throw new KoreksiError("Alasan pencabutan wajib diisi (minimal 10 karakter).", 400, "ALASAN_WAJIB");
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `keputusan_atribusi:${modul}:${documentId}`);
  const aktif = await tx.finAttributionDecision.findFirst({ where: { module: modul, documentId, revokedAt: null } });
  if (!aktif) return { dibuat: false, status: "TIDAK_ADA_KEPUTUSAN_AKTIF" };
  const jurnal = await jurnalBebanDokumen(tx, modul, documentId);
  const tertutup = await periodeTertutup(tx, jurnal.tanggal);
  if (tertutup.length) throw new KoreksiError(`Jurnal dokumen berada di periode yang sudah ditutup (${tertutup.join(", ")}).`, 409, "PERIODE_TERTUTUP");
  await tx.finAttributionDecision.update({ where: { id: aktif.id }, data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: teks.slice(0, 500) } });
  await recordActivity(tx, {
    entityType: MODUL_DIDUKUNG[modul].entitas, entityId: documentId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId ?? null,
    metadata: { aksi: "KEPUTUSAN_ATRIBUSI_DIVISI_DICABUT", nomor: aktif.documentNumber, before: { divisi: aktif.decidedScope }, after: { divisi: aktif.previousScope }, alasan: teks, keputusanId: aktif.id },
  });
  return { dibuat: true, status: "DICABUT", keputusanId: aktif.id };
}
