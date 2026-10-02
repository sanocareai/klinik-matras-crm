// PENCOCOKAN BANK ↔ BUKU (Rekonsiliasi Bank V2) — memuat data, menentukan status, dan tindakan pencocokan.
//
// JAMINAN: tidak ada jurnal yang dibuat/diubah di sini. Pencocokan hanya menautkan baris bank (fin_bank_import_lines) dengan baris jurnal yang SUDAH ada
// (fin_journal_lines) lewat kelompok pencocokan yang tidak pernah dihapus (hanya dibatalkan, riwayat tetap). Baris bank yang tidak ada di buku TIDAK dibukukan
// otomatis — tetap "Belum ada di buku" sampai Finance mencatat dokumennya lewat alur normal.
//
// Status baris bank : COCOK_OTOMATIS | COCOK_MANUAL | DISARANKAN | BELUM_ADA_DI_BUKU | DIKECUALIKAN
// Status baris buku : COCOK_OTOMATIS | COCOK_MANUAL | DISARANKAN | BELUM_ADA_DI_BANK | DIKECUALIKAN
import { STATUS_DIHITUNG } from "../journal.js";
import { toMoney, ZERO } from "../money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";
import { cariSaran, bentukKelompok, tebakKategori, JENDELA_HARI } from "./saran.js";
import {
  RekonError, wajibRekonV2Aktif, ambilRekening, uang, tgl, waktu, tanggalKolom, POLA_UUID, nilaiBank, nilaiBuku, STATUS_BANK, STATUS_BUKU, KATEGORI,
} from "./shared.js";
import { LABEL_SUMBER } from "../buku.js";

const BATAS_MUAT = 50_000;
const SUMBER_PENYESUAIAN = new Set(["SALDO_AWAL", "REKONSILIASI_SEMENTARA"]);
export const labelSumber = (s) => LABEL_SUMBER[s] ?? s;

/** Muat seluruh baris bank aktif & baris buku rekening (tanggal ≤ `sampai`) beserta kelompok pencocokan aktifnya. Baca-saja. */
export async function muatData(db, rek, { sampai }) {
  const batas = tanggalKolom(sampai);
  if (!batas) throw new RekonError("Tanggal akhir (to, YYYY-MM-DD) wajib diisi", 400, "TANGGAL_WAJIB");
  const [bank, buku] = await Promise.all([
    db.finBankImportLine.findMany({
      where: { cashAccountId: rek.id, rolledBackAt: null, txDate: { lte: batas } },
      orderBy: [{ txDate: "asc" }, { lineNo: "asc" }], take: BATAS_MUAT + 1,
      include: { matchItems: { where: { active: true }, select: { group: { select: { id: true, kind: true, category: true, reason: true, shape: true, createdAt: true } } } } },
    }),
    db.finJournalLine.findMany({
      where: { cashAccountId: rek.id, accountId: rek.accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: batas } } },
      orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { entry: { entryNumber: "asc" } }, { lineNo: "asc" }], take: BATAS_MUAT + 1,
      select: {
        id: true, debit: true, credit: true, description: true,
        entry: { select: { id: true, entryNumber: true, date: true, createdAt: true, description: true, source: true, sourceId: true, status: true, reversalOfId: true, createdBy: { select: { id: true, name: true } }, reversedBy: { select: { id: true } } } },
        order: { select: { id: true } },
        customer: { select: { name: true } }, supplier: { select: { name: true } },
        bankMatchItems: { where: { active: true }, select: { group: { select: { id: true, kind: true, category: true, reason: true, shape: true, createdAt: true } } } },
      },
    }),
  ]);
  if (bank.length > BATAS_MUAT || buku.length > BATAS_MUAT) throw new RekonError(`Data rekening melebihi ${BATAS_MUAT.toLocaleString("id-ID")} baris — persempit tanggal akhir.`, 422, "TERLALU_BESAR");
  return { bank, buku };
}

const grupDari = (items) => items?.[0]?.group ?? null;

/** Bentuk item bank/buku siap-hitung. */
export function normalisasi({ bank, buku }) {
  const b = bank.map((x) => ({
    id: x.id, tanggal: tgl(x.txDate), tanggalEfektif: tgl(x.effectiveDate), deskripsi: x.description, referensi: x.reference, debit: toMoney(x.debit), kredit: toMoney(x.credit),
    nilai: nilaiBank(x), saldo: x.runningBalance != null ? toMoney(x.runningBalance) : null, noBaris: x.lineNo, batchId: x.batchId, grup: grupDari(x.matchItems),
  }));
  const j = buku.map((x) => ({
    id: x.id, tanggal: tgl(x.entry.date), dibuatPada: x.entry.createdAt, nomor: x.entry.entryNumber, jurnalId: x.entry.id, deskripsi: x.description || x.entry.description,
    sumber: x.entry.source, sumberId: x.entry.sourceId, statusJurnal: x.entry.status, membalikId: x.entry.reversalOfId, dibalikOleh: x.entry.reversedBy?.id ?? null, aktor: x.entry.createdBy?.name ?? null,
    nilai: nilaiBuku(x), pihak: x.supplier?.name || x.customer?.name || null, grup: grupDari(x.bankMatchItems),
    teks: `${x.description || ""} ${x.entry.description || ""} ${x.entry.entryNumber} ${x.supplier?.name || ""} ${x.customer?.name || ""}`,
  }));
  return { bank: b, buku: j };
}

/**
 * Klasifikasi: status tiap baris + saran. Mengembalikan juga `kombinasi` (saran 1:N / N:1) dan daftar `otomatis` (pasangan 1:1 yang tidak ambigu).
 * Pasangan jurnal+pembaliknya yang sama-sama belum dicocokkan saling meniadakan (net 0) → dianggap DIKECUALIKAN otomatis (virtual; tidak disimpan).
 */
export function klasifikasi({ bank, buku }) {
  const bebasBank = bank.filter((x) => !x.grup);
  const bebasBuku = buku.filter((x) => !x.grup);

  // Pasangan jurnal & pembaliknya (belum dicocokkan, nilai berlawanan) → netral.
  const netral = new Set();
  const perJurnal = new Map();
  for (const l of bebasBuku) { if (!perJurnal.has(l.jurnalId)) perJurnal.set(l.jurnalId, []); perJurnal.get(l.jurnalId).push(l); }
  for (const l of bebasBuku) {
    if (!l.membalikId || netral.has(l.id)) continue;
    const asli = (perJurnal.get(l.membalikId) ?? []).find((o) => !netral.has(o.id) && o.nilai.plus(l.nilai).isZero());
    if (asli) { netral.add(asli.id); netral.add(l.id); }
  }
  // Penyesuaian buku (SALDO_AWAL/kalibrasi, REKONSILIASI_SEMENTARA) BUKAN transaksi bank: tidak pernah jadi kandidat pencocokan (sama seperti rekonsiliasi v1).
  const sisaBuku = bebasBuku.filter((x) => !netral.has(x.id) && !SUMBER_PENYESUAIAN.has(x.sumber));
  const saran = cariSaran({
    bank: bebasBank.map((x) => ({ id: x.id, tanggal: x.tanggal, nilai: x.nilai, deskripsi: x.deskripsi, referensi: x.referensi })),
    buku: sisaBuku.map((x) => ({ id: x.id, tanggal: x.tanggal, nilai: x.nilai, teks: x.teks })),
  });
  const komboBank = new Set(saran.kombinasi.flatMap((k) => k.bankIds));
  const komboBuku = new Set(saran.kombinasi.flatMap((k) => k.bukuIds));

  const statusBank = (x) => {
    if (x.grup) return x.grup.kind === "KECUALI" ? "DIKECUALIKAN" : x.grup.kind === "OTOMATIS" ? "COCOK_OTOMATIS" : "COCOK_MANUAL";
    return saran.kandidatBank.get(x.id)?.length || komboBank.has(x.id) ? "DISARANKAN" : "BELUM_ADA_DI_BUKU";
  };
  const statusBuku = (x) => {
    if (x.grup) return x.grup.kind === "KECUALI" ? "DIKECUALIKAN" : x.grup.kind === "OTOMATIS" ? "COCOK_OTOMATIS" : "COCOK_MANUAL";
    if (netral.has(x.id)) return "DIKECUALIKAN";
    return saran.kandidatBuku.get(x.id)?.length || komboBuku.has(x.id) ? "DISARANKAN" : "BELUM_ADA_DI_BANK";
  };
  return {
    bank: bank.map((x) => ({ ...x, status: statusBank(x), statusLabel: STATUS_BANK[statusBank(x)], saran: saran.kandidatBank.get(x.id) ?? [] })),
    buku: buku.map((x) => ({
      ...x, status: statusBuku(x), statusLabel: STATUS_BUKU[statusBuku(x)], saran: saran.kandidatBuku.get(x.id) ?? [], dikecualikanOtomatis: netral.has(x.id),
      penyesuaianBuku: SUMBER_PENYESUAIAN.has(x.sumber),
    })),
    kombinasi: saran.kombinasi, otomatis: saran.otomatis, ambigu: saran.otomatis.length,
  };
}

const bentukBank = (x, status) => ({
  id: x.id, tanggal: x.tanggal, tanggalEfektif: x.tanggalEfektif, deskripsi: x.deskripsi, referensi: x.referensi, masuk: x.kredit.greaterThan(0) ? uang(x.kredit) : null, keluar: x.debit.greaterThan(0) ? uang(x.debit) : null,
  saldo: x.saldo ? uang(x.saldo) : null, noBaris: x.noBaris, status: status ?? x.status, statusLabel: STATUS_BANK[status ?? x.status],
  pencocokan: x.grup ? { id: x.grup.id, jenis: x.grup.kind, bentuk: x.grup.shape, kategori: x.grup.category, kategoriLabel: KATEGORI[x.grup.category] ?? null, alasan: x.grup.reason } : null, saran: x.saran?.length ?? 0,
});
const bentukBuku = (x) => ({
  id: x.id, tanggalBuku: x.tanggal, dibuatPada: waktu(x.dibuatPada), nomor: x.nomor, jurnalId: x.jurnalId, deskripsi: x.deskripsi, sumber: x.sumber, sumberLabel: labelSumber(x.sumber), sumberId: x.sumberId, aktor: x.aktor,
  masuk: x.nilai.greaterThan(0) ? uang(x.nilai) : null, keluar: x.nilai.isNegative() ? uang(x.nilai.abs()) : null, status: x.status, statusLabel: x.statusLabel, penyesuaianBuku: !!x.penyesuaianBuku, dikecualikanOtomatis: !!x.dikecualikanOtomatis,
  pencocokan: x.grup ? { id: x.grup.id, jenis: x.grup.kind, bentuk: x.grup.shape, kategori: x.grup.category, kategoriLabel: KATEGORI[x.grup.category] ?? null, alasan: x.grup.reason } : null, saran: x.saran?.length ?? 0,
});
export { bentukBank, bentukBuku };

/** Periode rekonsiliasi selesai (berlaku) yang menutup tanggal tertentu pada rekening ini, atau null. */
async function periodeMenutup(db, cashAccountId, tanggal) {
  return db.finBankReconPeriod.findFirst({ where: { cashAccountId, invalidatedAt: null, periodTo: { gte: tanggalKolom(tanggal) } }, orderBy: { periodTo: "desc" }, select: { id: true, periodTo: true } });
}
async function pastikanPeriodeTerbuka(db, cashAccountId, tanggalList) {
  const awal = tanggalList.filter(Boolean).sort()[0];
  if (!awal) return;
  const p = await periodeMenutup(db, cashAccountId, awal);
  if (p) throw new RekonError(`Periode rekonsiliasi sampai ${tgl(p.periodTo)} sudah selesai — batalkan periodenya dulu bila memang perlu mengubah pencocokan.`, 409, "PERIODE_SELESAI");
}

// ── Daftar untuk layar ─────────────────────────────────────────────────────────────────────────────────────────

/** Tab Pencocokan: baris bank & buku belum dicocokkan (dengan saran), kelompok pencocokan aktif, dan saran kombinasi. */
export async function daftarPencocokan(db, { cashAccountId, to, from = null }) {
  const rek = await ambilRekening(db, cashAccountId);
  const data = klasifikasi(normalisasi(await muatData(db, rek, { sampai: to })));
  const mulai = from && tanggalKolom(from) ? from : null;
  const dalam = (x) => !mulai || x.tanggal >= mulai;
  const bankBelum = data.bank.filter((x) => !x.grup && dalam(x));
  // Baris buku yang jauh SEBELUM data bank pertama (mis. jurnal saldo awal) sudah tercakup saldo awal rekening koran — tidak mungkin ada pasangannya di berkas, jadi tidak ditampilkan sebagai
  // "belum dicocokkan" (jumlahnya dilaporkan terpisah). Tanpa data bank sama sekali, daftar buku kosong: impor rekening koran dulu.
  const tglPertama = data.bank[0]?.tanggal ?? null;
  const batasBuku = tglPertama ? new Date(Date.parse(`${tglPertama}T00:00:00Z`) - JENDELA_HARI * 86400000).toISOString().slice(0, 10) : null;
  const bukuTakBerpasangan = data.buku.filter((x) => !x.grup && !x.dikecualikanOtomatis && !x.penyesuaianBuku);
  const penyesuaianBuku = data.buku.filter((x) => !x.grup && x.penyesuaianBuku).length;
  const bukuBelum = bukuTakBerpasangan.filter((x) => tglPertama && x.tanggal >= batasBuku && dalam(x));
  const bukuSebelumDataBank = bukuTakBerpasangan.length - bukuTakBerpasangan.filter((x) => tglPertama && x.tanggal >= batasBuku).length;
  const ringkas = (arr, f) => arr.reduce((t, x) => t.plus(f(x)), ZERO);
  const hitung = (arr, st) => arr.filter((x) => x.status === st).length;
  // Kelompok aktif: gabungkan baris per kelompok.
  const kelompok = new Map();
  const taruh = (x, sisi) => { if (!x.grup) return; if (!kelompok.has(x.grup.id)) kelompok.set(x.grup.id, { ...x.grup, bank: [], buku: [] }); kelompok.get(x.grup.id)[sisi].push(sisi === "bank" ? bentukBank(x) : bentukBuku(x)); };
  data.bank.forEach((x) => taruh(x, "bank")); data.buku.forEach((x) => taruh(x, "buku"));
  const idBank = new Map(data.bank.map((x) => [x.id, x])); const idBuku = new Map(data.buku.map((x) => [x.id, x]));
  return {
    rekening: { id: rek.id, nama: rek.name, jenis: rek.kind },
    sampai: to, dari: mulai,
    ringkasan: {
      bankBelumDicocokkan: bankBelum.length, bukuBelumDicocokkan: bukuBelum.length, bukuSebelumDataBank, penyesuaianBuku, adaDataBank: !!tglPertama,
      nilaiBankBelum: uang(ringkas(bankBelum, (x) => x.nilai)), nilaiBukuBelum: uang(ringkas(bukuBelum, (x) => x.nilai)),
      disarankan: hitung(bankBelum, "DISARANKAN") + hitung(bukuBelum, "DISARANKAN"), bisaOtomatis: data.otomatis.length,
      cocok: [...kelompok.values()].filter((g) => g.kind !== "KECUALI").length, dikecualikan: [...kelompok.values()].filter((g) => g.kind === "KECUALI").length,
    },
    bank: bankBelum.map((x) => ({ ...bentukBank(x), kandidat: x.saran.slice(0, 5).map((s) => { const j = idBuku.get(s.bukuId); return { id: s.bukuId, nomor: j.nomor, tanggal: j.tanggal, deskripsi: j.deskripsi, selisihHari: s.selisihHari }; }) })),
    buku: bukuBelum.map((x) => ({ ...bentukBuku(x), kandidat: x.saran.slice(0, 5).map((s) => { const b = idBank.get(s.bankId); return { id: s.bankId, tanggal: b.tanggal, deskripsi: b.deskripsi, selisihHari: s.selisihHari }; }) })),
    kombinasi: data.kombinasi.map((k) => ({
      bentuk: k.bentuk, ambigu: k.ambigu, bankIds: k.bankIds, bukuIds: k.bukuIds,
      bank: k.bankIds.map((i) => idBank.get(i)).filter(Boolean).map((x) => bentukBank(x)), buku: k.bukuIds.map((i) => idBuku.get(i)).filter(Boolean).map((x) => bentukBuku(x)),
    })).filter((k) => k.bank.length && k.buku.length),
    kelompok: [...kelompok.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 500).map((g) => ({
      id: g.id, jenis: g.kind, bentuk: g.shape, kategori: g.category, kategoriLabel: KATEGORI[g.category] ?? null, alasan: g.reason, dibuatPada: waktu(g.createdAt), bank: g.bank, buku: g.buku,
    })),
    jendelaHari: JENDELA_HARI,
  };
}

/** Tab Mutasi Rekening (menurut BANK): baris rekening koran + status pencocokan; filter tanggal, pencarian, status. */
export async function mutasiBank(db, { cashAccountId, from, to, q, status, page, limit, semua = false }) {
  const rek = await ambilRekening(db, cashAccountId);
  const dari = tanggalKolom(from), sampai = tanggalKolom(to);
  if (!dari || !sampai) throw new RekonError("Periode (from & to, YYYY-MM-DD) wajib diisi", 400, "TANGGAL_WAJIB");
  if (dari > sampai) throw new RekonError("Tanggal awal tidak boleh setelah tanggal akhir", 400);
  const data = klasifikasi(normalisasi(await muatData(db, rek, { sampai: to })));
  const sebelum = data.bank.filter((x) => x.tanggal < from);
  const dalam = data.bank.filter((x) => x.tanggal >= from);
  const kata = String(q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const baris = dalam.filter((x) => (!status || x.status === status) && kata.every((w) => [x.deskripsi, x.referensi, uang(x.debit), uang(x.kredit), x.statusLabel].filter(Boolean).some((v) => String(v).toLowerCase().includes(w))));
  const masuk = dalam.reduce((t, x) => t.plus(x.kredit), ZERO), keluar = dalam.reduce((t, x) => t.plus(x.debit), ZERO);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200), hal = Math.max(parseInt(page, 10) || 1, 1);
  const ke = semua ? baris : baris.slice((hal - 1) * lim, hal * lim);
  const hitung = Object.fromEntries(Object.keys(STATUS_BANK).map((k) => [k, dalam.filter((x) => x.status === k).length]));
  return {
    rekening: { id: rek.id, nama: rek.name, jenis: rek.kind, bank: rek.bankName },
    periode: { from, to }, jumlahSebelumPeriode: sebelum.length, total: baris.length, jumlahBaris: dalam.length, totalMasuk: uang(masuk), totalKeluar: uang(keluar), perStatus: hitung,
    saldoAwalBank: dalam[0]?.saldo ? uang(dalam[0].saldo.minus(dalam[0].kredit).plus(dalam[0].debit)) : null, saldoAkhirBank: dalam.at(-1)?.saldo ? uang(dalam.at(-1).saldo) : null,
    page: semua ? 1 : hal, limit: semua ? baris.length : lim, adaLagi: semua ? false : hal * lim < baris.length, baris: ke.map((x) => bentukBank(x)),
  };
}

// ── Tindakan ────────────────────────────────────────────────────────────────────────────────────────────────────
const unik = (a) => [...new Set(a)];
function periksaIds(ids, nama, maks = 50) {
  if (!Array.isArray(ids)) return [];
  const u = unik(ids.map(String));
  if (u.some((i) => !POLA_UUID.test(i))) throw new RekonError(`Id ${nama} tidak valid`, 400, "ID_TIDAK_VALID");
  if (u.length > maks) throw new RekonError(`Maksimal ${maks} baris ${nama} per pencocokan`, 400, "TERLALU_BANYAK");
  return u;
}
const alasanMin = (a, min = 10) => {
  const t = String(a ?? "").trim();
  if (t.length < min) throw new RekonError(`Alasan wajib diisi (minimal ${min} karakter)`, 400, "ALASAN_WAJIB");
  return t;
};
const kunciRekon = (tx, id) => tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `REKON_V2:${id}`);

async function muatTerpilih(tx, rek, bankIds, jurnalIds) {
  const bank = bankIds.length ? await tx.finBankImportLine.findMany({ where: { id: { in: bankIds }, cashAccountId: rek.id, rolledBackAt: null }, include: { matchItems: { where: { active: true }, select: { id: true } } } }) : [];
  const buku = jurnalIds.length ? await tx.finJournalLine.findMany({
    where: { id: { in: jurnalIds }, cashAccountId: rek.id, accountId: rek.accountId, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { id: true, debit: true, credit: true, entry: { select: { id: true, entryNumber: true, date: true, source: true } }, bankMatchItems: { where: { active: true }, select: { id: true } } },
  }) : [];
  if (bank.length !== bankIds.length) throw new RekonError("Ada baris bank yang tidak ditemukan pada rekening ini (atau sudah dibatalkan)", 404, "BANK_TIDAK_ADA");
  if (buku.length !== jurnalIds.length) throw new RekonError("Ada baris buku yang bukan milik rekening ini (atau jurnalnya batal)", 404, "BUKU_TIDAK_ADA");
  if (bank.some((b) => b.matchItems.length) || buku.some((j) => j.bankMatchItems.length)) throw new RekonError("Ada baris yang sudah dicocokkan/dikecualikan. Lepaskan dulu pencocokan lamanya.", 409, "SUDAH_DICOCOKKAN");
  return { bank, buku };
}

/** Pencocokan MANUAL (1:1, 1:N, N:1, N:N): total bank harus sama PERSIS dengan total buku; alasan wajib; tercatat di audit. */
export async function cocokkanManual(db, { cashAccountId, bankLineIds, journalLineIds, alasan, kategori = null, userId = null }) {
  await wajibRekonV2Aktif(db);
  const rek = await ambilRekening(db, cashAccountId);
  const bIds = periksaIds(bankLineIds, "bank"), jIds = periksaIds(journalLineIds, "buku");
  if (!bIds.length || !jIds.length) throw new RekonError("Pencocokan butuh sedikitnya satu baris bank dan satu baris buku. Untuk salah satu sisi saja, gunakan Kecualikan (wajib alasan).", 400, "SISI_KURANG");
  const teks = alasanMin(alasan);
  if (kategori && !KATEGORI[kategori]) throw new RekonError("Kategori tidak dikenal", 400, "KATEGORI_TIDAK_VALID");
  return db.$transaction(async (tx) => {
    await kunciRekon(tx, rek.id);
    const { bank, buku } = await muatTerpilih(tx, rek, bIds, jIds);
    const totalBank = bank.reduce((t, b) => t.plus(nilaiBank(b)), ZERO), totalBuku = buku.reduce((t, j) => t.plus(nilaiBuku(j)), ZERO);
    if (!totalBank.equals(totalBuku)) {
      throw new RekonError(`Pencocokan tidak seimbang: total bank ${uang(totalBank)} ≠ total buku ${uang(totalBuku)} (selisih ${uang(totalBank.minus(totalBuku))}). Pilih baris yang jumlahnya sama persis; selisih bukan alasan untuk dipaksa cocok.`, 422, "TIDAK_SEIMBANG");
    }
    await pastikanPeriodeTerbuka(tx, rek.id, [...bank.map((b) => tgl(b.txDate)), ...buku.map((j) => tgl(j.entry.date))]);
    const bedaHari = Math.max(...bank.flatMap((b) => buku.map((j) => Math.abs(Math.round((b.txDate - j.entry.date) / 86400000)))), 0);
    const kat = kategori || tebakKategori({ sumberJurnal: buku.map((j) => j.entry.source), deskripsiBank: bank.map((b) => b.description), bedaHari });
    const shape = bentukKelompok(bank.length, buku.length);
    const g = await tx.finBankMatchGroup.create({ data: { cashAccountId: rek.id, kind: "MANUAL", category: kat, reason: teks, shape, createdById: userId } });
    await tx.finBankMatchItem.createMany({ data: [...bank.map((b) => ({ groupId: g.id, bankLineId: b.id })), ...buku.map((j) => ({ groupId: g.id, journalLineId: j.id }))] });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: g.id, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "cocok", jenis: "MANUAL", bentuk: shape, cashAccountId: rek.id, rekening: rek.name, bankLineIds: bIds, journalLineIds: jIds, total: uang(totalBank), kategori: kat, alasan: teks } });
    return { groupId: g.id, bentuk: shape, kategori: kat, total: uang(totalBank) };
  }, { timeout: 60_000, maxWait: 20_000 });
}

/**
 * Cocokkan OTOMATIS: hanya pasangan 1:1 yang tidak ambigu (lihat saran.js). Mengembalikan jumlah yang dicocokkan dan jumlah yang DILEWATI karena ambigu — tidak pernah memaksa.
 * Data dimuat ulang DI DALAM transaksi (sesudah kunci) supaya dua orang yang menekan tombol bersamaan tidak membuat pasangan ganda.
 */
export async function cocokkanOtomatis(db, { cashAccountId, to, userId = null }) {
  await wajibRekonV2Aktif(db);
  const rek = await ambilRekening(db, cashAccountId);
  return db.$transaction(async (tx) => {
    await kunciRekon(tx, rek.id);
    const data = klasifikasi(normalisasi(await muatData(tx, rek, { sampai: to })));
    const idBank = new Map(data.bank.map((x) => [x.id, x])), idBuku = new Map(data.buku.map((x) => [x.id, x]));
    let dibuat = 0;
    const tutup = await periodeMenutup(tx, rek.id, "1900-01-01");
    for (const p of data.otomatis) {
      const b = idBank.get(p.bankId), j = idBuku.get(p.bukuId);
      if (tutup && (b.tanggal <= tgl(tutup.periodTo) || j.tanggal <= tgl(tutup.periodTo))) continue; // periode selesai tidak disentuh
      const bedaHari = Math.round((Date.parse(b.tanggal) - Date.parse(j.tanggal)) / 86400000);
      const kat = tebakKategori({ sumberJurnal: [j.sumber], deskripsiBank: [b.deskripsi], bedaHari });
      const g = await tx.finBankMatchGroup.create({ data: { cashAccountId: rek.id, kind: "OTOMATIS", category: kat, reason: "Nominal sama persis, selisih tanggal ≤ 3 hari, tidak ada kandidat lain", shape: "1:1", createdById: userId } });
      await tx.finBankMatchItem.createMany({ data: [{ groupId: g.id, bankLineId: b.id }, { groupId: g.id, journalLineId: j.id }] });
      dibuat += 1;
    }
    // Baris bank yang punya kandidat tetapi TIDAK dicocokkan otomatis (ambigu / selisih tanggal > 3 hari / kombinasi) — tetap menunggu keputusan manual.
    const sisaDisarankan = Math.max(0, data.bank.filter((x) => x.status === "DISARANKAN").length - dibuat);
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: rek.id, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "cocok", jenis: "OTOMATIS", bentuk: `${dibuat} pasangan 1:1`, cashAccountId: rek.id, rekening: rek.name, jumlah: dibuat } });
    return { dicocokkan: dibuat, sisaDisarankan };
  }, { timeout: 120_000, maxWait: 20_000 });
}

/** Kecualikan baris bank dan/atau buku dari pencocokan — WAJIB alasan; tetap tampil sebagai selisih yang diterima (bukan dihapus), bisa dibatalkan. */
export async function kecualikan(db, { cashAccountId, bankLineIds = [], journalLineIds = [], alasan, userId = null }) {
  await wajibRekonV2Aktif(db);
  const rek = await ambilRekening(db, cashAccountId);
  const bIds = periksaIds(bankLineIds, "bank"), jIds = periksaIds(journalLineIds, "buku");
  if (!bIds.length && !jIds.length) throw new RekonError("Pilih baris yang akan dikecualikan", 400, "PILIH_BARIS");
  const teks = alasanMin(alasan);
  return db.$transaction(async (tx) => {
    await kunciRekon(tx, rek.id);
    const { bank, buku } = await muatTerpilih(tx, rek, bIds, jIds);
    await pastikanPeriodeTerbuka(tx, rek.id, [...bank.map((b) => tgl(b.txDate)), ...buku.map((j) => tgl(j.entry.date))]);
    const shape = bIds.length && jIds.length ? bentukKelompok(bank.length, buku.length) : bIds.length ? "BANK_SAJA" : "BUKU_SAJA";
    const g = await tx.finBankMatchGroup.create({ data: { cashAccountId: rek.id, kind: "KECUALI", category: null, reason: teks, shape, createdById: userId } });
    await tx.finBankMatchItem.createMany({ data: [...bank.map((b) => ({ groupId: g.id, bankLineId: b.id })), ...buku.map((j) => ({ groupId: g.id, journalLineId: j.id }))] });
    const nilai = bank.reduce((t, b) => t.plus(nilaiBank(b)), ZERO).minus(buku.reduce((t, j) => t.plus(nilaiBuku(j)), ZERO));
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: g.id, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "dikecualikan", cashAccountId: rek.id, rekening: rek.name, bankLineIds: bIds, journalLineIds: jIds, selisihBankMinusBuku: uang(nilai), alasan: teks } });
    return { groupId: g.id, bentuk: shape };
  }, { timeout: 60_000, maxWait: 20_000 });
}

/** Batalkan kelompok pencocokan/pengecualian. Riwayat tetap (kelompok & item tidak dihapus). Alasan wajib. */
export async function lepasPencocokan(db, { groupId, alasan, userId = null }) {
  await wajibRekonV2Aktif(db);
  if (!POLA_UUID.test(String(groupId || ""))) throw new RekonError("Pencocokan tidak valid", 400);
  const teks = alasanMin(alasan);
  return db.$transaction(async (tx) => {
    const g0 = await tx.finBankMatchGroup.findUnique({ where: { id: groupId }, select: { id: true, cashAccountId: true } });
    if (!g0) throw new RekonError("Pencocokan tidak ditemukan", 404);
    await kunciRekon(tx, g0.cashAccountId);
    const g = await tx.finBankMatchGroup.findUnique({
      where: { id: groupId },
      include: { items: { where: { active: true }, include: { bankLine: { select: { txDate: true } }, journalLine: { select: { entry: { select: { date: true } } } } } } },
    });
    if (g.undoneAt) throw new RekonError("Pencocokan ini sudah dibatalkan", 409, "SUDAH_DIBATALKAN");
    await pastikanPeriodeTerbuka(tx, g.cashAccountId, g.items.map((i) => tgl(i.bankLine?.txDate ?? i.journalLine?.entry.date)));
    await tx.finBankMatchItem.updateMany({ where: { groupId, active: true }, data: { active: false } });
    await tx.finBankMatchGroup.update({ where: { id: groupId }, data: { undoneAt: new Date(), undoneById: userId, undoneReason: teks } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: groupId, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId, metadata: { aksi: "cocok_dibatalkan", jenis: g.kind, cashAccountId: g.cashAccountId, alasan: teks } });
    return { groupId, jumlahBaris: g.items.length };
  }, { timeout: 60_000, maxWait: 20_000 });
}
