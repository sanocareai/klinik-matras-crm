// B3.8 — KOREKSI FINANCE LANJUTAN: tagihan supplier & refund yang SUDAH DISETUJUI (28 Sep 2026).
//
// Pola sama dengan B3.7 (koreksiPembayaran.js): perubahan yang menyentuh angka buku besar TIDAK menimpa dokumen lama.
//  • Dokumen lama ditandai DIBATALKAN (jejak tetap, alasan "Dikoreksi — …");
//  • semua jurnal aktif dokumen lama DIBALIK (reversal resmi, bertanggal sama dengan jurnal asli sehingga periode lama tetap konsisten);
//  • dokumen BARU (versi pengganti; replacesBillId/replacesRefundId → lama, UNIQUE = satu dokumen hanya bisa diganti sekali) langsung
//    berstatus DISETUJUI dan menerbitkan jurnal pengganti lewat fungsi posting yang sama dengan alur normal;
//  • semuanya SATU transaksi database: gagal di mana pun = tidak ada yang berubah.
// PRATINJAU menjalankan kode yang sama persis lalu ROLLBACK; menyimpan butuh PIN Finance (step-up). Idempotency-Key OPSIONAL (middleware global memutar ulang
// respons bila dikirim); tanpa kunci pun klik ganda/koreksi paralel aman: baris dokumen dikunci + UNIQUE replaces* → satu menang, satu 409 SUDAH_DIGANTI.
//
// Perubahan ADMINISTRATIF (bukan angka buku besar) lewat /info: tanpa jurnal, cukup alasan + audit sebelum/sesudah.
//
// BLOKIR (kode + alasan + arah tindakan; dihitung server, dipakai UI dan dievaluasi ulang di bawah kunci):
//  Tagihan  : belum disetujui, sudah diganti/dibatalkan/ditolak, ADA_PEMBAYARAN (alokasi pembayaran supplier aktif), JURNAL_TIDAK_ADA,
//             SUDAH_DIREKONSILIASI, PERIODE_AKUNTANSI_TUTUP (jurnal lama dibalik pada tanggal aslinya → periodenya harus terbuka). Jenis tagihan & penerimaan barang tidak bisa diubah (klasifikasi → Batalkan & catat ulang).
//  Refund   : belum disetujui, sudah diganti/dibatalkan/ditolak, JURNAL_TIDAK_ADA, SUDAH_DIREKONSILIASI, PERIODE_REKON_SELESAI, PERIODE_AKUNTANSI_TUTUP,
//             PENGAKUAN_PENDAPATAN_BERUBAH (jurnal lama memakai akun lawan yang berbeda dari yang berlaku sekarang → koreksi ambigu).

import { toMoney, moneyToNumber } from "./money.js";
import { toBookDate, reverseJournal, generateDocumentNumber } from "./journal.js";
import { KoreksiError, snapshotJurnal, susunPratinjau, tautanJurnal, PratinjauKoreksi } from "./koreksiGate.js";
import { saldoBukuRekening, pandanganCutoff } from "./rekonSnapshot.js";
import { siapkanJenisTagihan, pastikanAmanDisetujui, JENIS_TAGIHAN } from "./jenisTagihan.js";
import { postSupplierBill, KEY as SUPPLIER_KEY } from "./posting/supplier.js";
import { postRefund, sisaBisaDirefund, pendapatanSudahDiakui, KEY as ORDER_KEY } from "./posting/orderRevenue.js";
import { SYSTEM_KEYS } from "./accounts.js";
import { getVerificationGate } from "./settings.js";
import { hitungBiayaTransfer } from "./transferFee.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

const ALASAN_MAKS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tolak = (alasan, arah, status, kode) => new KoreksiError(arah ? `${alasan} ${arah}` : alasan, status, kode);
const rupiah = (n) => `Rp${Number(n).toLocaleString("id-ID")}`;
const hari = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function alasanWajib(alasan) {
  const reason = String(alasan ?? "").trim().slice(0, ALASAN_MAKS);
  if (!reason) throw new KoreksiError("Alasan wajib diisi", 400, "ALASAN_WAJIB");
  return reason;
}

function teks(v, maks, nama) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (t.length > maks) throw new KoreksiError(`${nama} terlalu panjang (maksimal ${maks} karakter)`, 400, "TERLALU_PANJANG");
  return t || null;
}

function tanggalBuku(v, nama) {
  const s = String(v ?? "").trim().slice(0, 10);
  // Tanggal kalender yang benar-benar ada: "2026-02-31" DITOLAK (Date.UTC akan diam-diam menggesernya ke 3 Maret).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new KoreksiError(`${nama} tidak valid`, 400, "TANGGAL_TIDAK_VALID");
  }
  return toBookDate(s);
}

/** Id (uuid) opsional dari body; nilai rusak ditolak 400 (bukan berujung error Prisma 500). */
function idUuid(v, nama) {
  if (v === null || v === undefined || v === "") return null;
  if (!UUID.test(String(v))) throw new KoreksiError(`${nama} tidak valid`, 400, "ID_TIDAK_VALID");
  return String(v);
}

function nominal(v, nama) {
  let n;
  try { n = toMoney(v, { field: nama }); } catch { throw new KoreksiError(`${nama} bukan angka yang sah`, 400, "NOMINAL_TIDAK_VALID"); }
  if (n.lessThanOrEqualTo(0)) throw new KoreksiError(`${nama} harus lebih dari 0`, 400, "NOMINAL_TIDAK_VALID");
  return n;
}

/** Baris jurnal yang tercocok ke mutasi bank → Set id baris. */
async function barisTercocok(db, barisIds) {
  if (barisIds.length === 0) return new Set();
  const cocok = await db.finBankStatementLine.findMany({ where: { matchedLineId: { in: barisIds } }, select: { matchedLineId: true } });
  return new Set(cocok.map((c) => c.matchedLineId));
}

async function jurnalAktif(db, source, prefixKey) {
  return db.finJournalEntry.findMany({
    where: { source, status: "POSTED", idempotencyKey: { startsWith: prefixKey } },
    select: { id: true, sourceId: true, date: true, lines: { select: { id: true, accountId: true, cashAccountId: true, debit: true, orderId: true } } },
  });
}

/** Kunci baris jurnal aktif (pencocokan mutasi bank mengunci baris yang sama → tidak ada match ke baris yang sedang dibalik). */
async function kunciBarisJurnal(tx, source, sourceId) {
  // `source` bertipe enum di Postgres → ditulis sebagai literal (dari daftar tetap, bukan input pengguna), bukan parameter.
  if (!["TAGIHAN_SUPPLIER", "REFUND"].includes(source)) throw new Error(`Sumber jurnal tidak dikenal: ${source}`);
  await tx.$queryRawUnsafe(
    `SELECT l.id FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE e.source = '${source}' AND e.source_id = $1 AND e.status = 'POSTED' ORDER BY l.id FOR UPDATE OF l`,
    sourceId,
  );
}

/** Jurnal lama dibalik pada TANGGAL ASLINYA: periode akuntansi tempat jurnal itu berada harus masih terbuka. Mengembalikan "MM/YYYY" pertama yang tertutup, atau null. */
async function periodeTertutupDari(db, entries) {
  const kunci = [...new Set(entries.map((e) => `${new Date(e.date).getUTCFullYear()}-${new Date(e.date).getUTCMonth() + 1}`))];
  if (kunci.length === 0) return null;
  const tutup = await db.finPeriod.findMany({
    where: { status: "CLOSED", OR: kunci.map((k) => ({ year: Number(k.split("-")[0]), month: Number(k.split("-")[1]) })) },
    select: { year: true, month: true }, orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  return tutup[0] ? `${String(tutup[0].month).padStart(2, "0")}/${tutup[0].year}` : null;
}
const PESAN_PERIODE_TUTUP = (p) => `Periode akuntansi ${p} sudah ditutup, sedangkan jurnal lama harus dibalik pada tanggal aslinya.`;
const ARAH_PERIODE_TUTUP = "Buka kembali periodenya (Finance › Pengaturan) atau catat penyesuaian lewat Jurnal Umum oleh Admin.";

async function balikSemua(tx, entries, alasan, userId) {
  for (const e of entries) await reverseJournal(tx, { entryId: e.id, date: e.date, reason: alasan, userId });
}

// ════════════════════════════════════════════════════════════════════════════
// TAGIHAN SUPPLIER
// ════════════════════════════════════════════════════════════════════════════

/** Map billId → { kode, alasan, arah } | null. Batch (satu set query), tidak melempar. */
export async function blokirKoreksiTagihanBatch(db, ids) {
  const hasil = new Map(ids.map((id) => [id, null]));
  if (ids.length === 0) return hasil;
  const bills = await db.finSupplierBill.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, status: true, replacedBy: { select: { billNumber: true } },
      allocations: { where: { payment: { cancelledAt: null } }, select: { id: true } },
    },
  });
  const entries = await db.finJournalEntry.findMany({
    where: { source: "TAGIHAN_SUPPLIER", sourceId: { in: ids }, status: "POSTED", idempotencyKey: { startsWith: "TAGIHAN_SUPPLIER:" } },
    select: { sourceId: true, date: true, lines: { select: { id: true } } },
  });
  const cocok = await barisTercocok(db, entries.flatMap((e) => e.lines.map((l) => l.id)));

  for (const b of bills) {
    const set = (kode, alasan, arah) => hasil.set(b.id, { kode, alasan, arah });
    if (b.status === "DIBATALKAN") {
      if (b.replacedBy) set("SUDAH_DIGANTI", `Tagihan ini sudah dikoreksi dan digantikan ${b.replacedBy.billNumber}.`, "Buka Riwayat lalu koreksi versi terbarunya.");
      else set("SUDAH_DIBATALKAN", "Tagihan ini sudah dibatalkan.", "Catat tagihan baru bila memang perlu.");
      continue;
    }
    if (b.status === "DITOLAK") { set("DITOLAK", "Tagihan ini sudah ditolak.", "Catat tagihan baru bila memang perlu."); continue; }
    if (["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status)) { set("BELUM_DISETUJUI", "Tagihan ini belum disetujui, belum ada jurnalnya.", "Gunakan Edit (bukan Koreksi)."); continue; }
    if (b.allocations.length > 0 || ["DIBAYAR_SEBAGIAN", "LUNAS"].includes(b.status)) {
      set("ADA_PEMBAYARAN", `Tagihan ini sudah punya ${b.allocations.length || 1} pembayaran aktif ke supplier, sehingga hasil koreksi bisa ambigu.`, "Batalkan pembayarannya dulu di Supplier & Utang, lalu koreksi tagihan.");
      continue;
    }
    const aktif = entries.filter((e) => e.sourceId === b.id);
    if (aktif.length === 0) { set("JURNAL_TIDAK_ADA", "Tagihan ini belum punya jurnal aktif di buku besar, jadi tidak ada yang bisa dibalik dengan aman.", "Selesaikan dulu 'Posting Tertunda' di Finance, lalu coba lagi."); continue; }
    if (aktif.some((e) => e.lines.some((l) => cocok.has(l.id)))) {
      set("SUDAH_DIREKONSILIASI", "Jurnal tagihan ini sudah dicocokkan dengan mutasi bank di Rekonsiliasi Bank.", "Lepas pencocokannya di Rekonsiliasi Bank dulu, lalu koreksi.");
      continue;
    }
    const tutup = await periodeTertutupDari(db, aktif);
    if (tutup) set("PERIODE_AKUNTANSI_TUTUP", PESAN_PERIODE_TUTUP(tutup), ARAH_PERIODE_TUTUP);
  }
  return hasil;
}

export function menuKoreksiDokumen(blokir, { punyaIzin, tidakIzin = "Akun Anda tidak punya izin mengoreksi dokumen ini." }) {
  return {
    aktif: punyaIzin && !blokir,
    alasan: !punyaIzin ? tidakIzin : (blokir?.alasan ?? null),
    arah: !punyaIzin ? null : (blokir?.arah ?? null),
    kode: blokir?.kode ?? null,
  };
}

function normalisasiInfoTagihan(body) {
  const p = {};
  if (body.supplierRef !== undefined) p.supplierRef = teks(body.supplierRef, 100, "Nomor faktur supplier");
  if (body.dueDate !== undefined) p.dueDate = body.dueDate ? tanggalBuku(body.dueDate, "Jatuh tempo") : null;
  if (body.attachmentUrl !== undefined) p.attachmentUrl = teks(body.attachmentUrl, 500, "Lampiran");
  return p;
}

const sama = (k, a, b) => {
  if (k === "amount") return toMoney(a ?? 0).equals(toMoney(b ?? 0));
  if (["billDate", "dueDate", "date"].includes(k)) return hari(a) === hari(b);
  return (a ?? null) === (b ?? null);
};

async function cariTagihan(tx, billId) {
  if (!UUID.test(String(billId))) throw new KoreksiError("Tagihan tidak ditemukan", 404);
  await lockRowForUpdate(tx, '"fin_supplier_bills"', billId);
  const b = await tx.finSupplierBill.findUnique({ where: { id: billId }, include: { supplier: { select: { id: true, name: true } } } });
  if (!b) throw new KoreksiError("Tagihan tidak ditemukan", 404);
  return b;
}

/** Edit informasi tagihan yang SUDAH disetujui: nomor faktur supplier, jatuh tempo, lampiran. Tanpa jurnal. */
export async function editInfoTagihan(tx, { billId, body, alasan, userId }) {
  const reason = alasanWajib(alasan);
  const perubahan = normalisasiInfoTagihan(body || {});
  const b = await cariTagihan(tx, billId);
  if (b.status === "DIBATALKAN" || b.status === "DITOLAK") {
    throw tolak("Tagihan ini sudah dibatalkan/diganti.", "Buka Riwayat lalu ubah versi terbarunya.", 409, "SUDAH_DIBATALKAN");
  }
  const before = {}; const after = {};
  for (const [k, v] of Object.entries(perubahan)) {
    if (!sama(k, b[k], v)) { before[k] = b[k] instanceof Date ? hari(b[k]) : (b[k] ?? null); after[k] = v instanceof Date ? hari(v) : (v ?? null); }
  }
  if (Object.keys(after).length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  // Nomor faktur yang sama dari supplier yang sama tidak boleh ada di tagihan aktif lain (aturan yang sama saat disetujui).
  if (after.supplierRef) {
    const dobel = await tx.finSupplierBill.findFirst({
      where: { id: { not: b.id }, supplierId: b.supplierId, supplierRef: { equals: after.supplierRef, mode: "insensitive" }, status: { in: ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"] } },
      select: { billNumber: true },
    });
    if (dobel) throw tolak(`Faktur ${after.supplierRef} dari supplier ini sudah tercatat di ${dobel.billNumber}.`, null, 409, "FAKTUR_GANDA");
  }
  const updated = await tx.finSupplierBill.update({ where: { id: b.id }, data: perubahan });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: b.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
    metadata: { aksi: "edit_info_tagihan", billNumber: b.billNumber, reason, before, after },
  });
  return { ok: true, billId: b.id, before, after, tagihan: { id: updated.id, supplierRef: updated.supplierRef, dueDate: updated.dueDate, attachmentUrl: updated.attachmentUrl } };
}

function normalisasiKoreksiTagihan(body) {
  const p = {};
  if (body.supplierId !== undefined) {
    p.supplierId = idUuid(body.supplierId, "Supplier");
    if (!p.supplierId) throw new KoreksiError("Supplier wajib dipilih", 400, "SUPPLIER_WAJIB");
  }
  if (body.billDate !== undefined) p.billDate = tanggalBuku(body.billDate, "Tanggal tagihan");
  if (body.dueDate !== undefined) p.dueDate = body.dueDate ? tanggalBuku(body.dueDate, "Jatuh tempo") : null;
  if (body.amount !== undefined) p.amount = nominal(body.amount, "Nominal tagihan");
  if (body.description !== undefined) {
    const d = teks(body.description, 500, "Keterangan tagihan");
    if (!d) throw new KoreksiError("Keterangan tagihan wajib diisi", 400, "KETERANGAN_WAJIB");
    p.description = d;
  }
  for (const k of ["expenseCategoryId", "purchaseCategoryId", "goodsReceiptId"]) if (body[k] !== undefined) p[k] = idUuid(body[k], k === "goodsReceiptId" ? "Penerimaan barang" : "Kategori");
  if (body.billType !== undefined) p.billType = body.billType ? String(body.billType) : null;
  return p;
}

/**
 * Koreksi tagihan supplier yang SUDAH disetujui → versi pengganti + reversal jurnal lama + jurnal pengganti.
 * preview=true: jalankan semuanya lalu lempar PratinjauKoreksi (transaksi di-ROLLBACK oleh pemanggil).
 */
export async function koreksiTagihan(tx, { billId, body, alasan, userId, preview = false, stepUp = null }) {
  const reason = alasanWajib(alasan);
  const perubahan = normalisasiKoreksiTagihan(body || {});
  if (Object.keys(perubahan).length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  const lama = await cariTagihan(tx, billId);
  await kunciBarisJurnal(tx, "TAGIHAN_SUPPLIER", billId);
  const blokir = (await blokirKoreksiTagihanBatch(tx, [billId])).get(billId);
  if (blokir) throw tolak(blokir.alasan, blokir.arah, 409, blokir.kode);
  if (!preview && stepUp) await stepUp();

  // Klasifikasi (jenis & penerimaan barang) menentukan akun jurnal; mengubahnya = dokumen berbeda → Batalkan & catat ulang.
  // Pengecualian: tagihan lama tanpa jenis boleh dilengkapi jenisnya sekarang.
  if (perubahan.goodsReceiptId !== undefined && (perubahan.goodsReceiptId ?? null) !== (lama.goodsReceiptId ?? null)) {
    throw tolak("Penerimaan barang yang ditautkan tidak bisa diubah lewat koreksi.", "Batalkan tagihan lalu catat ulang dengan penerimaan yang benar.", 409, "PENERIMAAN_TIDAK_BISA_DIUBAH");
  }
  if (perubahan.billType !== undefined && lama.billType && perubahan.billType !== lama.billType) {
    throw tolak("Jenis tagihan tidak bisa diubah lewat koreksi.", "Batalkan tagihan lalu catat ulang dengan jenis yang benar.", 409, "JENIS_TIDAK_BISA_DIUBAH");
  }

  const nilai = {
    supplierId: perubahan.supplierId ?? lama.supplierId,
    billDate: perubahan.billDate ?? lama.billDate,
    dueDate: perubahan.dueDate !== undefined ? perubahan.dueDate : lama.dueDate,
    amount: perubahan.amount ?? lama.amount,
    description: perubahan.description ?? lama.description,
    billType: lama.billType ?? perubahan.billType ?? null,
    goodsReceiptId: lama.goodsReceiptId,
    expenseCategoryId: perubahan.expenseCategoryId !== undefined ? perubahan.expenseCategoryId : lama.expenseCategoryId,
    purchaseCategoryId: perubahan.purchaseCategoryId !== undefined ? perubahan.purchaseCategoryId : lama.purchaseCategoryId,
  };
  const kolom = ["supplierId", "billDate", "dueDate", "amount", "description", "billType", "expenseCategoryId", "purchaseCategoryId"];
  const beda = kolom.filter((k) => !sama(k, lama[k], nilai[k]));
  if (beda.length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  if (nilai.supplierId !== lama.supplierId) {
    const sup = await tx.finSupplier.findUnique({ where: { id: nilai.supplierId }, select: { active: true } });
    if (!sup || sup.active === false) throw new KoreksiError("Supplier tidak ditemukan atau nonaktif", 404, "SUPPLIER_TIDAK_VALID");
  }
  if (!nilai.billType) {
    throw tolak("Tagihan lama ini belum punya Jenis Tagihan.", "Sertakan jenis tagihan pada koreksi (mis. Bahan Baku, Jasa/Operasional).", 409, "JENIS_TAGIHAN_WAJIB");
  }
  // Aturan kategori/jenis divalidasi ulang sebagai satu kesatuan (sama dengan Edit & Setujui).
  await siapkanJenisTagihan(tx, { billType: nilai.billType, goodsReceiptId: nilai.goodsReceiptId, expenseCategoryId: nilai.expenseCategoryId, purchaseCategoryId: nilai.purchaseCategoryId, billDate: nilai.billDate });

  // 1) Balik jurnal lama pada tanggal aslinya.
  const sumberLama = [{ source: "TAGIHAN_SUPPLIER", sourceId: lama.id }];
  const sebelum = await snapshotJurnal(tx, sumberLama);
  const jurnalLama = await jurnalAktif(tx, "TAGIHAN_SUPPLIER", SUPPLIER_KEY.bill(lama.id));
  await balikSemua(tx, jurnalLama, `Koreksi tagihan ${lama.billNumber} — ${reason}`, userId);

  // 2) Dokumen lama → batal (jejak tetap). Setelah ini penjaga duplikat (faktur/penerimaan) tidak menghitungnya lagi.
  await tx.finSupplierBill.update({ where: { id: lama.id }, data: { status: "DIBATALKAN", rejectReason: `Dikoreksi — ${reason}`.slice(0, ALASAN_MAKS) } });

  // 3) Dokumen BARU (versi pengganti) langsung DISETUJUI oleh pengoreksi.
  const baru = await tx.finSupplierBill.create({
    data: {
      billNumber: await generateDocumentNumber(tx, "BILL", nilai.billDate),
      supplierRef: lama.supplierRef, supplierId: nilai.supplierId, billDate: nilai.billDate, dueDate: nilai.dueDate,
      amount: nilai.amount, description: nilai.description, attachmentUrl: lama.attachmentUrl,
      billType: nilai.billType, goodsReceiptId: nilai.goodsReceiptId,
      expenseCategoryId: nilai.expenseCategoryId, purchaseCategoryId: nilai.purchaseCategoryId,
      status: "DISETUJUI", approvedAt: new Date(), approvedById: userId, createdById: lama.createdById, replacesBillId: lama.id,
    },
  });
  // Cek "supplier punya penerimaan barang yang belum ditagih" DILEWATI bila supplier tidak berubah: tagihan ini sudah lolos cek itu saat pertama
  // disetujui, dan penerimaan yang datang SESUDAHNYA (mis. bulan berikutnya) tidak boleh mengunci koreksi tagihan periodik yang lama.
  await pastikanAmanDisetujui(tx, baru, { lewatiPenerimaanBelumDitagih: nilai.supplierId === lama.supplierId });
  await postSupplierBill(tx, { billId: baru.id, userId });

  const sumber = [...sumberLama, { source: "TAGIHAN_SUPPLIER", sourceId: baru.id }];
  const namaSupplier = async (id) => (id === lama.supplierId ? lama.supplier.name : (await tx.finSupplier.findUnique({ where: { id }, select: { name: true } }))?.name ?? id);
  const namaBiaya = async (id) => (id ? (await tx.finExpenseCategory.findUnique({ where: { id }, select: { name: true } }))?.name ?? id : null);
  const namaAset = async (id) => (id ? (await tx.finPurchaseCategory.findUnique({ where: { id }, select: { name: true } }))?.name ?? id : null);
  const tampil = async (o) => ({
    supplier: await namaSupplier(o.supplierId), tanggal: hari(o.billDate), jatuhTempo: hari(o.dueDate), nominal: moneyToNumber(o.amount),
    keterangan: o.description, jenis: JENIS_TAGIHAN[o.billType] ?? o.billType, kategoriBiaya: await namaBiaya(o.expenseCategoryId), kategoriAset: await namaAset(o.purchaseCategoryId),
  });
  const a = await tampil(lama); const d = await tampil(nilai);
  const before = {}; const after = {};
  for (const k of Object.keys(d)) if (String(a[k]) !== String(d[k])) { before[k] = a[k]; after[k] = d[k]; }

  if (preview) throw new PratinjauKoreksi(await susunPratinjau(tx, { sebelum, sources: sumber, perubahan: { before, after } }));

  const tautan = await tautanJurnal(tx, sebelum, sumber);
  const meta = { billNumber: lama.billNumber, reason, before, after, ...tautan };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: lama.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { aksi: "koreksi_tagihan", digantiOleh: baru.id, nomorPengganti: baru.billNumber, ...meta } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { aksi: "koreksi_tagihan", menggantikan: lama.id, nomorLama: lama.billNumber, ...meta } });
  return { ok: true, lamaId: lama.id, baruId: baru.id, nomorBaru: baru.billNumber, ...tautan };
}

// ════════════════════════════════════════════════════════════════════════════
// REFUND
// ════════════════════════════════════════════════════════════════════════════

/** Map refundId → { kode, alasan, arah } | null. */
export async function blokirKoreksiRefundBatch(db, ids) {
  const hasil = new Map(ids.map((id) => [id, null]));
  if (ids.length === 0) return hasil;
  const refunds = await db.finRefund.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, orderId: true, replacedBy: { select: { refundNumber: true } } },
  });
  const entries = await db.finJournalEntry.findMany({
    where: { source: "REFUND", sourceId: { in: ids }, status: "POSTED", idempotencyKey: { startsWith: "REFUND:" } },
    select: { id: true, sourceId: true, date: true, lines: { select: { id: true, accountId: true, cashAccountId: true, debit: true, orderId: true } } },
  });
  const cocok = await barisTercocok(db, entries.flatMap((e) => e.lines.map((l) => l.id)));
  const kasIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.cashAccountId)).filter(Boolean))];
  const rekon = kasIds.length
    ? await db.finBankStatement.findMany({ where: { status: "SELESAI", cashAccountId: { in: kasIds } }, select: { cashAccountId: true, periodStart: true, periodEnd: true } })
    : [];
  const akunUM = await db.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UANG_MUKA_PELANGGAN }, select: { id: true } });
  const akunRetur = await db.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.RETUR_PENJUALAN }, select: { id: true } });

  for (const r of refunds) {
    const set = (kode, alasan, arah) => hasil.set(r.id, { kode, alasan, arah });
    if (r.status === "DIBATALKAN") {
      if (r.replacedBy) set("SUDAH_DIGANTI", `Refund ini sudah dikoreksi dan digantikan ${r.replacedBy.refundNumber}.`, "Buka Riwayat lalu koreksi versi terbarunya.");
      else set("SUDAH_DIBATALKAN", "Refund ini sudah dibatalkan.", "Ajukan refund baru bila memang perlu.");
      continue;
    }
    if (r.status === "DITOLAK") { set("DITOLAK", "Refund ini sudah ditolak.", "Ajukan refund baru bila memang perlu."); continue; }
    if (r.status === "MENUNGGU_APPROVAL") { set("BELUM_DISETUJUI", "Refund ini belum disetujui, belum ada jurnalnya.", "Gunakan Edit (bukan Koreksi)."); continue; }
    const aktif = entries.filter((e) => e.sourceId === r.id);
    if (aktif.length === 0) { set("JURNAL_TIDAK_ADA", "Refund ini belum punya jurnal aktif di buku besar, jadi tidak ada yang bisa dibalik dengan aman.", "Selesaikan dulu 'Posting Tertunda' di Finance, lalu coba lagi."); continue; }
    if (aktif.some((e) => e.lines.some((l) => cocok.has(l.id)))) {
      set("SUDAH_DIREKONSILIASI", "Jurnal refund ini sudah dicocokkan dengan mutasi bank di Rekonsiliasi Bank.", "Lepas pencocokannya di Rekonsiliasi Bank dulu, lalu koreksi.");
      continue;
    }
    if (aktif.some((e) => e.lines.some((l) => l.cashAccountId && rekon.some((p) => p.cashAccountId === l.cashAccountId && e.date >= p.periodStart && e.date <= p.periodEnd)))) {
      set("PERIODE_REKON_SELESAI", "Periode Rekonsiliasi Bank untuk rekening ini sudah SELESAI, jadi angkanya tidak boleh berubah.", "Buka kembali rekonsiliasi periode itu (Admin) atau catat penyesuaian lewat Jurnal Umum.");
      continue;
    }
    // Akun lawan jurnal lama vs yang berlaku sekarang (bergantung pengakuan pendapatan order). Beda = ambigu.
    const diakui = await pendapatanSudahDiakui(db, r.orderId);
    const akunSekarang = diakui ? akunRetur?.id : akunUM?.id;
    const akunLawan = [akunUM?.id, akunRetur?.id].filter(Boolean);
    const akunLama = aktif.flatMap((e) => e.lines).find((l) => l.orderId === r.orderId && akunLawan.includes(l.accountId) && toMoney(l.debit).greaterThan(0))?.accountId;
    if (akunLama && akunSekarang && akunLama !== akunSekarang) {
      set("PENGAKUAN_PENDAPATAN_BERUBAH", "Status pengakuan pendapatan order ini berubah sejak refund dibukukan (akun lawan lama ≠ yang berlaku sekarang), sehingga membaliknya bisa merusak pembagian Uang Muka/Piutang order itu.", "Koreksi lewat Jurnal Umum resmi oleh Admin (jangan Batalkan lalu ajukan ulang — pembagian Uang Muka/Piutang tidak disesuaikan otomatis).");
      continue;
    }
    const tutup = await periodeTertutupDari(db, aktif);
    if (tutup) set("PERIODE_AKUNTANSI_TUTUP", PESAN_PERIODE_TUTUP(tutup), ARAH_PERIODE_TUTUP);
  }
  return hasil;
}

async function cariRefund(tx, refundId) {
  if (!UUID.test(String(refundId))) throw new KoreksiError("Refund tidak ditemukan", 404);
  await lockRowForUpdate(tx, '"fin_refunds"', refundId);
  const r = await tx.finRefund.findUnique({ where: { id: refundId }, include: { cashAccount: { select: { id: true, name: true } }, order: { select: { orderNumber: true } } } });
  if (!r) throw new KoreksiError("Refund tidak ditemukan", 404);
  return r;
}

/** Edit informasi refund yang SUDAH disetujui: alasan refund & lampiran. Tanpa jurnal (teks keterangan jurnal lama tetap sebagai jejak). */
export async function editInfoRefund(tx, { refundId, body, alasan, userId }) {
  const reason = alasanWajib(alasan);
  const perubahan = {};
  if (body?.alasanRefund !== undefined) {
    const t = teks(body.alasanRefund, 500, "Alasan refund");
    if (!t) throw new KoreksiError("Alasan refund wajib diisi", 400, "ALASAN_REFUND_WAJIB");
    perubahan.reason = t;
  }
  if (body?.attachmentUrl !== undefined) perubahan.attachmentUrl = teks(body.attachmentUrl, 500, "Lampiran");
  const r = await cariRefund(tx, refundId);
  if (r.status === "DIBATALKAN" || r.status === "DITOLAK") {
    throw tolak("Refund ini sudah dibatalkan/diganti.", "Buka Riwayat lalu ubah versi terbarunya.", 409, "SUDAH_DIBATALKAN");
  }
  const before = {}; const after = {};
  for (const [k, v] of Object.entries(perubahan)) if ((r[k] ?? null) !== (v ?? null)) { before[k] = r[k] ?? null; after[k] = v ?? null; }
  if (Object.keys(after).length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  await tx.finRefund.update({ where: { id: r.id }, data: perubahan });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_REFUND, entityId: r.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
    metadata: { aksi: "edit_info_refund", refundNumber: r.refundNumber, reason, before, after },
  });
  return { ok: true, refundId: r.id, before, after };
}

function normalisasiKoreksiRefund(body) {
  const p = {};
  if (body.amount !== undefined) p.amount = nominal(body.amount, "Nominal refund");
  if (body.date !== undefined) p.date = tanggalBuku(body.date, "Tanggal refund");
  if (body.cashAccountId !== undefined) {
    if (!body.cashAccountId) throw new KoreksiError("Rekening sumber pengembalian wajib dipilih", 400, "REKENING_WAJIB");
    p.cashAccountId = idUuid(body.cashAccountId, "Rekening");
  }
  for (const k of ["paymentMethod", "transferFeeType", "transferFeeAmount"]) if (body[k] !== undefined) p[k] = body[k];
  if (body.alasanRefund !== undefined) {
    const t = teks(body.alasanRefund, 500, "Alasan refund");
    if (!t) throw new KoreksiError("Alasan refund wajib diisi", 400, "ALASAN_REFUND_WAJIB");
    p.reason = t;
  }
  return p;
}

/** Koreksi refund yang SUDAH disetujui → versi pengganti + reversal jurnal lama + jurnal pengganti; status bayar order dihitung ulang. */
export async function koreksiRefund(tx, { refundId, body, alasan, userId, preview = false, stepUp = null }) {
  const reason = alasanWajib(alasan);
  const perubahan = normalisasiKoreksiRefund(body || {});
  if (Object.keys(perubahan).length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  const lama = await cariRefund(tx, refundId);
  await lockRowForUpdate(tx, '"Order"', lama.orderId, { cast: null }); // urutan kunci sama dengan approve/cancel refund: refund → order
  await kunciBarisJurnal(tx, "REFUND", refundId);
  // Kunci baris rekonsiliasi bank untuk rekening lama & baru (urut id): POST /bank-statements/:id/complete mengunci baris statement yang sama, jadi
  // status SELESAI tidak bisa berubah di antara pemeriksaan blokir dan commit koreksi (jurnal tidak bisa menyusup ke periode yang baru diselesaikan).
  const rekeningTerkait = [...new Set([lama.cashAccountId, perubahan.cashAccountId].filter(Boolean))];
  await tx.$queryRawUnsafe(
    "SELECT id FROM fin_bank_statements WHERE cash_account_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    rekeningTerkait,
  );
  const blokir = (await blokirKoreksiRefundBatch(tx, [refundId])).get(refundId);
  if (blokir) throw tolak(blokir.alasan, blokir.arah, 409, blokir.kode);
  if (!preview && stepUp) await stepUp();

  const metodeBaru = perubahan.paymentMethod !== undefined ? perubahan.paymentMethod : lama.paymentMethod;
  const cashBaru = perubahan.cashAccountId ?? lama.cashAccountId;
  const sentuhBiaya = ["paymentMethod", "transferFeeType", "transferFeeAmount"].some((k) => perubahan[k] !== undefined) || cashBaru !== lama.cashAccountId;
  let biaya = { paymentMethod: lama.paymentMethod, transferFeeType: lama.transferFeeType, transferFeeAmount: toMoney(lama.transferFeeAmount) };
  if (sentuhBiaya) {
    const m = String(metodeBaru || "").toUpperCase();
    biaya = await hitungBiayaTransfer(tx, {
      cashAccountId: cashBaru, paymentMethod: metodeBaru,
      transferFeeType: m === "TRANSFER" ? (perubahan.transferFeeType !== undefined ? perubahan.transferFeeType : lama.transferFeeType) : null,
      transferFeeAmount: m === "TRANSFER" ? (perubahan.transferFeeAmount !== undefined ? perubahan.transferFeeAmount : lama.transferFeeAmount) : 0,
    });
  }
  const nilai = { amount: perubahan.amount ?? lama.amount, date: perubahan.date ?? lama.date, reason: perubahan.reason ?? lama.reason, cashAccountId: cashBaru };
  const beda = ["amount", "date", "reason", "cashAccountId"].some((k) => !sama(k, lama[k], nilai[k]))
    || !toMoney(lama.transferFeeAmount).equals(biaya.transferFeeAmount) || (lama.paymentMethod ?? null) !== (biaya.paymentMethod ?? null) || (lama.transferFeeType ?? null) !== (biaya.transferFeeType ?? null);
  if (!beda) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  const rek = await tx.finCashAccount.findUnique({ where: { id: cashBaru }, select: { id: true, name: true, active: true } });
  if (!rek || !rek.active) throw new KoreksiError("Rekening sumber pengembalian tidak ditemukan atau sudah nonaktif", 400, "REKENING_TIDAK_VALID");
  const rekonBaru = await tx.finBankStatement.findFirst({
    where: { status: "SELESAI", cashAccountId: cashBaru, periodStart: { lte: nilai.date }, periodEnd: { gte: nilai.date } }, select: { id: true },
  });
  if (rekonBaru) throw tolak("Periode Rekonsiliasi Bank untuk rekening dan tanggal tujuan sudah SELESAI.", "Pilih tanggal/rekening lain atau buka kembali rekonsiliasinya (Admin).", 409, "PERIODE_REKON_SELESAI");

  const sumberLama = [{ source: "REFUND", sourceId: lama.id }];
  const sebelum = await snapshotJurnal(tx, sumberLama);
  const jurnalLama = await jurnalAktif(tx, "REFUND", ORDER_KEY.refund(lama.id));
  const ordSebelum = await tx.order.findUnique({ where: { id: lama.orderId }, select: { orderNumber: true, paymentStatus: true, paidAt: true } });

  // Periode rekonsiliasi (BELUM selesai) yang tersentuh — saldo buku SEBELUM dicatat untuk audit.
  const kasTanggal = jurnalLama.flatMap((e) => e.lines.filter((l) => l.cashAccountId).map((l) => ({ cashAccountId: l.cashAccountId, date: e.date })));
  kasTanggal.push({ cashAccountId: cashBaru, date: nilai.date });
  const kandidat = await tx.finBankStatement.findMany({
    where: { status: { not: "SELESAI" }, OR: kasTanggal.map((k) => ({ cashAccountId: k.cashAccountId, periodStart: { lte: k.date }, periodEnd: { gte: k.date } })) },
    orderBy: { id: "asc" },
  });
  const saldoSebelum = new Map();
  for (const st of kandidat) saldoSebelum.set(st.id, await saldoBukuRekening(tx, st.cashAccountId, st.periodEnd));

  // 1) Balik jurnal lama; 2) dokumen lama → batal; 3) validasi nominal baru terhadap uang yang benar-benar diterima (refund lama sudah tidak dihitung).
  await balikSemua(tx, jurnalLama, `Koreksi refund ${lama.refundNumber} — ${reason}`, userId);
  await tx.finRefund.update({ where: { id: lama.id }, data: { status: "DIBATALKAN", rejectReason: `Dikoreksi — ${reason}`.slice(0, ALASAN_MAKS) } });
  const sisa = await sisaBisaDirefund(tx, lama.orderId, await getVerificationGate(tx));
  if (toMoney(nilai.amount).greaterThan(sisa)) {
    throw tolak(`Refund ${rupiah(moneyToNumber(nilai.amount))} melebihi uang yang diterima untuk order ini (sisa yang bisa dikembalikan: ${rupiah(moneyToNumber(sisa))}).`, "Turunkan nominal.", 409, "MELEBIHI_UANG_DITERIMA");
  }

  // 4) Dokumen BARU (versi pengganti) langsung DISETUJUI + jurnal pengganti; status bayar order dihitung ulang.
  const baru = await tx.finRefund.create({
    data: {
      refundNumber: await generateDocumentNumber(tx, "RFD", nilai.date), orderId: lama.orderId, date: nilai.date, amount: nilai.amount, reason: nilai.reason,
      cashAccountId: cashBaru, paymentMethod: biaya.paymentMethod, transferFeeType: biaya.transferFeeType, transferFeeAmount: biaya.transferFeeAmount,
      attachmentUrl: lama.attachmentUrl, status: "DISETUJUI", approvedAt: new Date(), approvedById: userId, createdById: lama.createdById, replacesRefundId: lama.id,
    },
  });
  await postRefund(tx, { refundId: baru.id, userId });
  await recomputeOrderPaymentStatus(tx, lama.orderId);
  const ordSesudah = await tx.order.findUnique({ where: { id: lama.orderId }, select: { paymentStatus: true, paidAt: true } });

  const sumber = [...sumberLama, { source: "REFUND", sourceId: baru.id }];
  const tampilRek = async (id) => (id === lama.cashAccountId ? lama.cashAccount.name : rek.name);
  const a = { nominal: moneyToNumber(lama.amount), tanggal: hari(lama.date), rekeningSumber: lama.cashAccount.name, metode: lama.paymentMethod, biayaTransfer: moneyToNumber(lama.transferFeeAmount), alasanRefund: lama.reason };
  const d = { nominal: moneyToNumber(nilai.amount), tanggal: hari(nilai.date), rekeningSumber: await tampilRek(cashBaru), metode: biaya.paymentMethod, biayaTransfer: moneyToNumber(biaya.transferFeeAmount), alasanRefund: nilai.reason };
  const before = {}; const after = {};
  for (const k of Object.keys(d)) if (String(a[k]) !== String(d[k])) { before[k] = a[k]; after[k] = d[k]; }

  const periodeRekon = [];
  for (const st of kandidat) {
    const sesudah = await saldoBukuRekening(tx, st.cashAccountId, st.periodEnd);
    const snap = await tx.finReconSnapshot.findUnique({ where: { statementId: st.id } });
    const pandangan = snap ? await pandanganCutoff(tx, snap, { closingBank: st.closingBalance }) : null;
    periodeRekon.push({
      statementId: st.id, status: st.status, periodStart: st.periodStart, periodEnd: st.periodEnd, cashAccountId: st.cashAccountId,
      saldoBukuSebelum: moneyToNumber(saldoSebelum.get(st.id)), saldoBukuSesudah: moneyToNumber(sesudah), selisihBankSesudah: moneyToNumber(toMoney(st.closingBalance).minus(sesudah)),
      snapshotAda: !!snap, snapshotValid: pandangan ? pandangan.valid : null,
    });
  }
  const dampakStatus = [{ orderId: lama.orderId, nomor: ordSebelum?.orderNumber, statusLama: ordSebelum?.paymentStatus ?? null, statusBaru: ordSesudah?.paymentStatus ?? null, paidAtLama: ordSebelum?.paidAt ?? null, paidAtBaru: ordSesudah?.paidAt ?? null }];

  if (preview) {
    const data = await susunPratinjau(tx, { sebelum, sources: sumber, perubahan: { before, after } });
    throw new PratinjauKoreksi({ ...data, dampakStatus, periodeRekon });
  }

  const tautan = await tautanJurnal(tx, sebelum, sumber);
  const meta = { refundNumber: lama.refundNumber, reason, before, after, ...tautan };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_REFUND, entityId: lama.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { aksi: "koreksi_refund", digantiOleh: baru.id, nomorPengganti: baru.refundNumber, ...meta } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_REFUND, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { aksi: "koreksi_refund", menggantikan: lama.id, nomorLama: lama.refundNumber, ...meta } });
  for (const pr of periodeRekon) {
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: pr.statementId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
      metadata: { label: "Refund dikoreksi setelah periode dibuat", aksi: "refund_dikoreksi", refundLamaId: lama.id, refundBaruId: baru.id, reason, ...pr },
    });
  }
  return { ok: true, lamaId: lama.id, baruId: baru.id, nomorBaru: baru.refundNumber, dampakStatus, periodeRekon, ...tautan };
}

