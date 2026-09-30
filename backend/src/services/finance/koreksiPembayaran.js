// B3.7 — KOREKSI PEMBAYARAN MASUK TERVERIFIKASI (Sep 2026).
//
// Finance bisa memperbaiki pembayaran yang sudah diverifikasi TANPA menghapus histori dan tanpa merusak jurnal/saldo/invoice/status order/alokasi.
//
// DUA JALUR:
//  1. EDIT INFORMASI (editInfoPembayaran) — bukti, catatan, nomor referensi, keterangan internal. Bukan angka buku besar: TIDAK ada jurnal;
//     yang berubah hanya kolom informasi + audit sebelum/sesudah (ActivityEvent).
//  2. KOREKSI PEMBAYARAN (koreksiPembayaran) — nominal, tanggal, rekening, metode, order, alokasi. Payment lama TIDAK di-update isinya:
//       • Payment lama ditandai batal (cancelledAt/cancelReason) — jejaknya tetap;
//       • jurnal penerimaan lama DIBALIK (reversal resmi, bertanggal sama dengan jurnal asli sehingga periode lama tetap konsisten);
//       • Payment BARU (versi pengganti, replacesPaymentId → lama, UNIQUE = satu Payment hanya bisa diganti sekali) + alokasi + verifikasi;
//       • jurnal pengganti lewat postPaymentReceived (kredit Uang Muka bila pendapatan order belum diakui, kredit Piutang bila sudah);
//       • status/paidAt SEMUA order terkait dihitung ulang; invoice membaca Payment aktif sehingga ikut benar.
//     PRATINJAU memakai kode yang SAMA persis lalu di-ROLLBACK (koreksiGate.susunPratinjau); menyimpan butuh PIN Finance (step-up).
//
// TRUE-UP UANG MUKA vs PIUTANG per order yang pendapatannya SUDAH diakui: jurnal pengakuan memindahkan uang muka (yang saat itu tercatat) ke Piutang.
// Membalik jurnal Payment lama (yang mengkredit Uang Muka) lalu memasang pengganti (yang mengkredit Piutang) membuat pembagian Uang Muka/Piutang order itu
// meleset. Karena itu, SETELAH pengganti masuk, tiap order terdampak yang sudah diakui pendapatannya dinormalkan ke keadaan kanonis:
// selisih bersih R = Piutang − Uang Muka; R > 0 → Uang Muka 0, Piutang R; R < 0 (kelebihan bayar) → Piutang 0, Uang Muka −R. Selisihnya diposting sebagai
// jurnal Dr/Cr Piutang↔Uang Muka BERTANGGAL jurnal pengakuan (periode lama tetap konsisten; bila periodenya tertutup, koreksi ditolak).
//
// PAIDAT: order yang terdampak dihitung ulang dengan paidAtEfektif — tanggal pembayaran (menurut tanggal efektif lalu ID, kontribusi sadar-alokasi)
// yang pertama kali membuat total yang dihitung mencapai tagihan kanonis; null bila belum lunas; TIDAK pernah waktu koreksi (paymentLedger.js#tanggalLunasEfektif).
//
// REKONSILIASI: periode SELESAI dan jurnal yang sudah dicocokkan ke mutasi bank memblokir. Periode DRAFT / DRAF_MENUNGGU_MUTASI yang belum dicocokkan boleh
// dikoreksi: ringkasan periode (saldo buku sebelum/sesudah, selisih ke saldo bank, keabsahan snapshot) dihitung ulang dan dicatat sebagai audit
// "Pembayaran dikoreksi setelah periode dibuat" pada periode itu. Snapshot (immutable) TIDAK disentuh — koreksi masuk sebagai reversal/posting setelah snapshot.
//
// BLOKIR (dengan alasan + arah tindakan): sudah dibatalkan/diganti, belum diverifikasi, jurnal tidak ada/pra-saldo-awal (tidak aman dibalik),
// ada refund aktif, klaim Lunas Resi menunggu, jurnal sudah dicocokkan rekonsiliasi bank, atau periode Rekonsiliasi Bank rekening itu SELESAI.
//
// Kunci: grup → order (id naik) → payment (services/finance/urutanKunci.js) — sama dengan perintah uang lain. Double-klik/replay ditangani
// Idempotency-Key di route; request paralel berbeda-kunci: baris payment dikunci + cek cancelledAt + UNIQUE replacesPaymentId → satu menang, satu 409.

import { moneyToNumber, toMoney } from "./money.js";
import { todayBookDateWIB, toBookDate, reverseJournal, postJournal, findEntryByKey } from "./journal.js";
import { resolveCashAccountForPayment } from "./settings.js";
import { KoreksiError, snapshotJurnal, susunPratinjau, tautanJurnal, PratinjauKoreksi } from "./koreksiGate.js";
import { postPaymentReceived, KEY as KEY_ORDER } from "./posting/orderRevenue.js";
import { SYSTEM_KEYS } from "./accounts.js";
import { paidForOrder, setAllocations, AllocationError } from "./allocation.js";
import { kunciUntukPayment } from "./urutanKunci.js";
import { PILIH_TAGIHAN, tagihanOrder, dasarStatusBayar } from "./tagihanOrder.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { saldoBukuRekening, pandanganCutoff } from "./rekonSnapshot.js";
import { bagiProporsional } from "../resi.js";
import { validasiAlokasiResi, muatGrupResi, muatDibayar, hitungAlokasiResi, TIPE_BAYAR, pastikanGrupLayak, ResiBayarError } from "../resiPembayaran.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";
import { tanggalCutoff, sebelumCutoff, tampilCutoff } from "./cutoff.js";

const GATE_MATI = { enabled: false };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METODE = ["CASH", "TRANSFER", "QRIS", "CARD"];
const PREFIX_BUKTI = "/media/payment-proofs";
const ALASAN_MAKS = 500;
const rupiah = (n) => `Rp${Number(n).toLocaleString("id-ID")}`;
const tanggalWIB = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const tolak = (alasan, arah, status, kode) => new KoreksiError(arah ? `${alasan} ${arah}` : alasan, status, kode);

// ── Blokir ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Alasan koreksi finansial DITOLAK per payment (batch — satu set query untuk banyak payment, dipakai daftar dan koreksi).
 * Mengembalikan Map paymentId → { kode, alasan, arah } | null. TIDAK melempar.
 */
export async function blokirKoreksiBatch(db, ids, { izinkanPraSaldoAwal = false } = {}) {
  const hasil = new Map(ids.map((id) => [id, null]));
  if (ids.length === 0) return hasil;
  const ps = await db.payment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, orderId: true, createdAt: true, cancelledAt: true, replacedBy: { select: { id: true } },
      verifications: { select: { id: true } }, finAllocations: { select: { orderId: true } },
      order: { select: { group: { select: { lunasDiklaimPada: true } } } },
    },
  });
  const entries = await db.finJournalEntry.findMany({
    where: { source: "PEMBAYARAN_ORDER", sourceId: { in: ids }, status: "POSTED", NOT: { idempotencyKey: { contains: ":RECLAS" } } },
    select: { id: true, sourceId: true, date: true, lines: { select: { id: true, accountId: true, cashAccountId: true } } },
  });
  const laba = await db.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.LABA_DITAHAN }, select: { id: true } });
  const cutoff = await tanggalCutoff(db);
  // Payment terverifikasi yang MASIH punya "Posting Tertunda" (belum berjurnal karena rekening belum dipetakan / posting ditolak) boleh dikoreksi:
  // tidak ada jurnal yang dibalik, versi pengganti langsung dibukukan ke rekening yang benar dan gap lama ditutup.
  const gapTerbuka = new Set((await db.finPostingGap.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: { in: ids }, resolvedAt: null, NOT: { reason: "SEBELUM_SALDO_AWAL" } }, select: { sourceId: true } })).map((g) => g.sourceId));

  const semuaOrder = [...new Set(ps.flatMap((p) => [p.orderId, ...p.finAllocations.map((a) => a.orderId)]))];
  const refunds = semuaOrder.length
    ? await db.finRefund.findMany({ where: { orderId: { in: semuaOrder }, status: { in: ["MENUNGGU_APPROVAL", "DISETUJUI"] } }, select: { orderId: true, refundNumber: true } })
    : [];
  // Klaim Lunas order TUNGGAL: order ditandai LUNAS (mis. oleh Sales) padahal uang tercatat belum menutup tagihan → koreksi dapat menghapus paidAt diam-diam.
  const lunas = semuaOrder.length
    ? await db.order.findMany({ where: { id: { in: semuaOrder }, paymentStatus: "LUNAS" }, select: { ...PILIH_TAGIHAN, orderNumber: true } })
    : [];
  const klaimLunasOrder = new Map();
  for (const o of lunas) {
    if (moneyToNumber(await paidForOrder(db, o.id, GATE_MATI)) < dasarStatusBayar(o, o.group)) klaimLunasOrder.set(o.id, o.orderNumber);
  }
  const barisIds = entries.flatMap((e) => e.lines.map((l) => l.id));
  const cocok = barisIds.length
    ? await db.finBankStatementLine.findMany({ where: { matchedLineId: { in: barisIds } }, select: { matchedLineId: true } })
    : [];
  const barisCocok = new Set(cocok.map((c) => c.matchedLineId));
  const kasIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.cashAccountId)).filter(Boolean))];
  const rekon = kasIds.length
    ? await db.finBankStatement.findMany({ where: { status: "SELESAI", cashAccountId: { in: kasIds } }, select: { cashAccountId: true, periodStart: true, periodEnd: true } })
    : [];

  for (const p of ps) {
    const set = (kode, alasan, arah) => hasil.set(p.id, { kode, alasan, arah });
    if (p.cancelledAt) {
      if (p.replacedBy) set("SUDAH_DIGANTI", "Pembayaran ini sudah dikoreksi dan digantikan versi baru.", "Buka Riwayat Perubahan lalu koreksi versi terbarunya.");
      else set("SUDAH_DIBATALKAN", "Pembayaran ini sudah dibatalkan.", "Catat pembayaran baru bila uangnya memang masuk.");
      continue;
    }
    if (p.verifications.length === 0) {
      set("BELUM_DIVERIFIKASI", "Pembayaran ini belum diverifikasi.", "Verifikasi atau tolak dulu; koreksi hanya untuk uang masuk yang sudah terverifikasi.");
      continue;
    }
    const aktif = entries.filter((e) => e.sourceId === p.id);
    if (aktif.length === 0 && !gapTerbuka.has(p.id)) {
      set("JURNAL_TIDAK_ADA", "Pembayaran ini belum punya jurnal aktif di buku besar, jadi tidak ada yang bisa dibalik dengan aman.", "Selesaikan dulu 'Posting Tertunda' di Finance, lalu coba lagi.");
      continue;
    }
    if (laba && aktif.some((e) => e.lines.some((l) => l.accountId === laba.id))) {
      set("PRA_SALDO_AWAL", "Pembayaran ini dibukukan sebagai uang masuk sebelum saldo awal (lawannya Laba Ditahan), bukan kas berjalan.", "Koreksi lewat Jurnal Umum resmi oleh Admin, bukan lewat menu ini.");
      continue;
    }
    // Pembayaran bertanggal SEBELUM saldo awal yang masih punya jurnal Bank/Kas = kas terhitung dua kali. Koreksi umum akan memasang jurnal Bank
    // pengganti yang sama salahnya, jadi diblokir; jalurnya khusus: penuntasan pembayaran historis (Finance Admin).
    if (!izinkanPraSaldoAwal && sebelumCutoff(p.createdAt, cutoff) && aktif.some((e) => e.lines.some((l) => l.cashAccountId))) {
      set("SEBELUM_SALDO_AWAL", `Pembayaran ini bertanggal sebelum saldo awal (${tampilCutoff(cutoff)}), jadi uangnya sudah tercakup di saldo kas/bank dan tidak boleh dijurnal ke rekening lagi.`, "Minta Finance Admin menuntaskannya lewat penuntasan pembayaran historis.");
      continue;
    }
    const refund = refunds.find((r) => r.orderId === p.orderId || p.finAllocations.some((a) => a.orderId === r.orderId));
    if (refund) {
      set("ADA_REFUND", `Order terkait sudah punya refund aktif (${refund.refundNumber}), sehingga hasil koreksi bisa ambigu.`, "Batalkan atau selesaikan refund itu dulu di Refund Pelanggan.");
      continue;
    }
    const idKlaim = [p.orderId, ...p.finAllocations.map((a) => a.orderId)].find((id) => klaimLunasOrder.has(id));
    if (idKlaim) {
      set("KLAIM_LUNAS_ORDER", `Order ${klaimLunasOrder.get(idKlaim)} ditandai Lunas, tetapi uang yang tercatat belum menutup seluruh tagihannya.`, "Verifikasi atau tolak klaim Lunas itu dulu di Perlu Verifikasi Finance, lalu koreksi.");
      continue;
    }
    if (p.order?.group?.lunasDiklaimPada) {
      set("KLAIM_LUNAS_AKTIF", "Resi ini sedang diklaim Lunas dan menunggu verifikasi Finance.", "Verifikasi atau tolak klaim Lunas Resi dulu di Perlu Verifikasi Finance.");
      continue;
    }
    if (aktif.some((e) => e.lines.some((l) => barisCocok.has(l.id)))) {
      set("SUDAH_DIREKONSILIASI", "Jurnal pembayaran ini sudah dicocokkan dengan mutasi bank di Rekonsiliasi Bank.", "Lepas pencocokannya di Rekonsiliasi Bank dulu, lalu koreksi.");
      continue;
    }
    const tutup = aktif.find((e) => e.lines.some((l) => l.cashAccountId && rekon.some((r) => r.cashAccountId === l.cashAccountId && e.date >= r.periodStart && e.date <= r.periodEnd)));
    if (tutup) {
      set("PERIODE_REKON_SELESAI", "Periode Rekonsiliasi Bank untuk rekening ini sudah SELESAI, jadi angkanya tidak boleh berubah.", "Buka kembali rekonsiliasi periode itu (Admin) atau catat penyesuaian lewat Jurnal Umum.");
    }
  }
  return hasil;
}

/** Keadaan tiga tombol menu pembayaran untuk satu baris (dihitung server; klien tidak menyalin aturan). */
export function menuKoreksi(p, { punyaIzin, blokir }) {
  const tidakIzin = "Akun Anda tidak punya izin mengoreksi pembayaran.";
  const batal = p.cancelledAt ? (p.replacedBy ? "Pembayaran ini sudah diganti versi baru." : "Pembayaran ini sudah dibatalkan.") : null;
  return {
    lihatDetail: { aktif: true },
    editInfo: { aktif: punyaIzin && !batal, alasan: !punyaIzin ? tidakIzin : batal, arah: batal ? "Buka Riwayat Perubahan untuk versi terbaru." : null },
    koreksi: { aktif: punyaIzin && !blokir, alasan: !punyaIzin ? tidakIzin : (blokir?.alasan ?? null), arah: !punyaIzin ? null : (blokir?.arah ?? null), kode: blokir?.kode ?? null },
    riwayat: { aktif: true },
  };
}

// ── Edit Informasi ──────────────────────────────────────────────────────────────────────────────────────────────

const teks = (v, maks, nama) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (t.length > maks) throw new KoreksiError(`${nama} terlalu panjang (maksimal ${maks} karakter)`, 400, "TERLALU_PANJANG");
  return t || null;
};

function normalisasiInfo(body) {
  const p = {};
  if (body.proofPhotoUrl !== undefined) {
    const u = body.proofPhotoUrl ? String(body.proofPhotoUrl).trim() : null;
    if (u && !u.startsWith(`${PREFIX_BUKTI}/`)) throw new KoreksiError("Bukti harus berupa foto yang diunggah lewat sistem", 400, "BUKTI_TIDAK_VALID");
    p.proofPhotoUrl = u;
  }
  if (body.notes !== undefined) p.notes = teks(body.notes, 1000, "Catatan");
  if (body.referenceNumber !== undefined) p.referenceNumber = teks(body.referenceNumber, 100, "Nomor referensi");
  if (body.internalNote !== undefined) p.internalNote = teks(body.internalNote, 1000, "Keterangan internal");
  return p;
}

export async function editInfoPembayaran(tx, { paymentId, body, alasan, userId }) {
  const reason = String(alasan ?? "").trim().slice(0, ALASAN_MAKS);
  if (!reason) throw new KoreksiError("Alasan perubahan wajib diisi", 400, "ALASAN_WAJIB");
  const perubahan = normalisasiInfo(body || {});
  if (!(await kunciUntukPayment(tx, paymentId))) throw new KoreksiError("Pembayaran tidak ditemukan", 404);
  const p = await tx.payment.findUnique({ where: { id: paymentId } });
  if (p.cancelledAt) throw tolak("Pembayaran ini sudah dibatalkan atau diganti versi baru.", "Buka Riwayat Perubahan lalu ubah versi terbarunya.", 409, "SUDAH_DIBATALKAN");

  const before = {}; const after = {};
  for (const [k, v] of Object.entries(perubahan)) {
    if ((p[k] ?? null) !== (v ?? null)) { before[k] = p[k] ?? null; after[k] = v ?? null; }
  }
  if (Object.keys(after).length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  // Mengganti foto bukti UTAMA (yang pertama) menjaga foto tambahan tetap ada: proofPhotoUrls disinkronkan.
  if ("proofPhotoUrl" in after) {
    const sisa = (p.proofPhotoUrls ?? []).slice(1);
    before.proofPhotoUrls = p.proofPhotoUrls ?? [];
    after.proofPhotoUrls = [after.proofPhotoUrl, ...sisa].filter(Boolean);
  }
  const baru = await tx.payment.update({ where: { id: paymentId }, data: after });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.PAYMENT, entityId: paymentId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
    metadata: { aksi: "edit_info_pembayaran", reason, before, after },
  });
  return { ok: true, paymentId, before, after, pembayaran: { id: baru.id, proofPhotoUrl: baru.proofPhotoUrl, notes: baru.notes, referenceNumber: baru.referenceNumber, internalNote: baru.internalNote } };
}

// ── Koreksi ─────────────────────────────────────────────────────────────────────────────────────────────────────

function normalisasiPerubahan(body) {
  const p = {};
  if (body.amount !== undefined) {
    const n = Number(body.amount);
    if (!Number.isInteger(n) || n <= 0) throw new KoreksiError("Nominal harus bilangan bulat rupiah lebih dari 0", 400, "NOMINAL_TIDAK_VALID");
    p.amount = n;
  }
  if (body.tanggal !== undefined) {
    const s = String(body.tanggal ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) throw new KoreksiError("Tanggal pembayaran tidak valid (format YYYY-MM-DD)", 400, "TANGGAL_TIDAK_VALID");
    if (new Date(`${s}T00:00:00Z`) > todayBookDateWIB()) throw new KoreksiError("Tanggal pembayaran tidak boleh di masa depan", 400, "TANGGAL_MASA_DEPAN");
    p.tanggal = s;
  }
  if (body.cashAccountId !== undefined) {
    if (body.cashAccountId !== null && !UUID.test(String(body.cashAccountId))) throw new KoreksiError("Rekening penerima tidak valid", 400, "REKENING_TIDAK_VALID");
    p.cashAccountId = body.cashAccountId || null;
  }
  if (body.method !== undefined) {
    if (!METODE.includes(body.method)) throw new KoreksiError("Metode pembayaran tidak dikenali", 400, "METODE_TIDAK_VALID");
    p.method = body.method;
  }
  if (body.orderId !== undefined) {
    if (!body.orderId || typeof body.orderId !== "string") throw new KoreksiError("Order tujuan tidak valid", 400, "ORDER_TIDAK_VALID");
    p.orderId = body.orderId;
  }
  if (body.alokasi !== undefined) {
    if (!Array.isArray(body.alokasi) || body.alokasi.length === 0) throw new KoreksiError("Alokasi tidak boleh kosong", 400, "ALOKASI_KOSONG");
    p.alokasi = body.alokasi.map((a) => {
      const amt = Number(a?.amount);
      if (!a?.orderId || !Number.isInteger(amt) || amt <= 0) throw new KoreksiError("Setiap baris alokasi butuh order dan nominal rupiah bulat lebih dari 0", 400, "ALOKASI_TIDAK_VALID");
      return { orderId: String(a.orderId), amount: amt };
    });
  }
  return p;
}

const ambilJurnalAktif = (tx, paymentId) => tx.finJournalEntry.findMany({
  where: { source: "PEMBAYARAN_ORDER", sourceId: paymentId, status: "POSTED", NOT: { idempotencyKey: { contains: ":RECLAS" } } },
  include: { lines: true }, orderBy: { createdAt: "asc" },
});

/**
 * Koreksi satu Payment terverifikasi. `preview` = true → seluruh langkah dijalankan lalu di-ROLLBACK (melempar PratinjauKoreksi dengan hasilnya).
 * `stepUp` (async, dipanggil hanya bila BUKAN preview, SEBELUM menulis) = pemanggil menegakkan PIN Finance.
 */
export async function koreksiPembayaran(tx, { paymentId, body, alasan, userId, preview = false, stepUp = null }) {
  const reason = String(alasan ?? "").trim().slice(0, ALASAN_MAKS);
  if (!reason) throw new KoreksiError("Alasan koreksi wajib diisi", 400, "ALASAN_WAJIB");
  const perubahan = normalisasiPerubahan(body || {});
  if (Object.keys(perubahan).length === 0) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  // 1) Kunci kanonis (grup → order lama+tujuan → payment), lalu baca ULANG di bawah kunci.
  const orderTambahan = [perubahan.orderId, ...(perubahan.alokasi ?? []).map((a) => a.orderId)].filter(Boolean);
  if (!(await kunciUntukPayment(tx, paymentId, { orderTambahan }))) throw new KoreksiError("Pembayaran tidak ditemukan", 404);
  const lama = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      finAllocations: { include: { order: { select: { orderNumber: true } } }, orderBy: { orderId: "asc" } },
      cashAccount: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, groupId: true, group: { select: { source: true } }, customer: { select: { name: true } } } },
    },
  });
  // Kunci baris jurnal aktif payment ini SEBELUM blokir dievaluasi: pencocokan mutasi bank (POST /bank-lines/:id/match) mengunci baris jurnal yang sama,
  // sehingga match paralel tidak bisa menempel ke baris yang sedang dibalik (dan sebaliknya).
  await tx.$queryRawUnsafe(
    "SELECT l.id FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = $1 AND e.status = 'POSTED' ORDER BY l.id FOR UPDATE OF l",
    paymentId,
  );
  const blokir = (await blokirKoreksiBatch(tx, [paymentId])).get(paymentId);
  if (blokir) throw tolak(blokir.alasan, blokir.arah, 409, blokir.kode);
  if (!preview && stepUp) await stepUp();

  const adaAlokasiLama = lama.finAllocations.length > 0;
  const resi = !!(lama.order.groupId && lama.order.group?.source === "BARU");
  if (resi && perubahan.orderId && perubahan.orderId !== lama.orderId) {
    throw tolak("Pembayaran Resi tidak bisa dipindah ke order/customer lain lewat menu ini.", "Ubah pembagian antar-item Resi lewat Alokasi, atau batalkan lalu catat ulang.", 409, "RESI_PINDAH_ORDER");
  }
  if (perubahan.orderId && adaAlokasiLama && !perubahan.alokasi) {
    throw tolak("Pembayaran ini dibagi ke beberapa order.", "Ubah order tujuan lewat Alokasi (pilih order dan nominal per baris).", 409, "PERLU_ALOKASI");
  }

  // 2) Nilai akhir (setelah perubahan) — kolom yang nilainya SAMA dengan aslinya tidak dianggap perubahan.
  const tanggalLama = tanggalWIB(lama.createdAt);
  const amountBaru = perubahan.amount ?? lama.amount;
  const methodBaru = perubahan.method ?? lama.method;
  const cashBaru = perubahan.cashAccountId !== undefined ? perubahan.cashAccountId : lama.cashAccountId;
  const tanggalBaru = perubahan.tanggal ?? tanggalLama;
  const orderIdBaru = resi ? lama.orderId : (perubahan.orderId ?? lama.orderId);
  // Tanggal berubah → jam 12 WIB (05:00 UTC), konvensi penerimaanOrder; tanggal sama → createdAt asli dipertahankan persis.
  const [ty, tm, td] = tanggalBaru.split("-").map(Number);
  const createdAtBaru = tanggalBaru === tanggalLama ? lama.createdAt : new Date(Date.UTC(ty, tm - 1, td, 5));

  const perubahanNyata = amountBaru !== lama.amount || methodBaru !== lama.method || (cashBaru ?? null) !== (lama.cashAccountId ?? null)
    || tanggalBaru !== tanggalLama || orderIdBaru !== lama.orderId || !!perubahan.alokasi;
  if (!perubahanNyata) throw new KoreksiError("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  // Guard cutoff: tanggal pembayaran tidak boleh dimundurkan ke sebelum saldo awal lewat koreksi umum (jurnal penggantinya akan menambah kas lagi).
  const cutoff = await tanggalCutoff(tx);
  if (sebelumCutoff(tanggalBaru, cutoff)) {
    throw tolak(`Tanggal pembayaran ${tanggalBaru} jatuh sebelum saldo awal (${tampilCutoff(cutoff)}), sehingga tidak boleh menambah kas/bank.`, "Pembayaran historis dituntaskan Finance Admin lewat penuntasan pembayaran historis, bukan lewat Koreksi Pembayaran.", 409, "TANGGAL_SEBELUM_SALDO_AWAL");
  }

  if (cashBaru) {
    const rek = await tx.finCashAccount.findUnique({ where: { id: cashBaru }, select: { id: true, name: true, active: true } });
    if (!rek || !rek.active) throw new KoreksiError("Rekening penerima tidak ditemukan atau sudah nonaktif", 400, "REKENING_TIDAK_VALID");
  }
  // Rekening EFEKTIF tujuan (termasuk pemetaan cara bayar bila rekening tidak dipilih) + tanggal buku UTC persis seperti yang akan dipakai jurnal pengganti.
  const rekTujuan = await resolveCashAccountForPayment(tx, { cashAccountId: cashBaru ?? null, method: methodBaru });
  if (rekTujuan) {
    const tglBuku = toBookDate(createdAtBaru);
    const rekonBaru = await tx.finBankStatement.findFirst({
      where: { status: "SELESAI", cashAccountId: rekTujuan.id, periodStart: { lte: tglBuku }, periodEnd: { gte: tglBuku } },
      select: { id: true },
    });
    if (rekonBaru) throw tolak("Periode Rekonsiliasi Bank untuk rekening dan tanggal tujuan sudah SELESAI.", "Pilih tanggal/rekening lain atau buka kembali rekonsiliasinya (Admin).", 409, "PERIODE_REKON_SELESAI");
  }

  // Order yang bisa berubah statusnya: lama ∪ tujuan ∪ (Resi: semua child) — foto SEBELUM untuk pratinjau dampak.
  const idLama = [lama.orderId, ...lama.finAllocations.map((a) => a.orderId)];
  const idTujuan = [orderIdBaru, ...(perubahan.alokasi ?? []).map((a) => a.orderId)];
  let idTerdampak = [...new Set([...idLama, ...idTujuan])];
  if (resi) {
    const anak = await tx.order.findMany({ where: { groupId: lama.order.groupId, status: { not: "CANCELLED" } }, select: { id: true } });
    idTerdampak = [...new Set([...idTerdampak, ...anak.map((a) => a.id)])];
  }
  const fotoStatus = async () => new Map((await tx.order.findMany({ where: { id: { in: idTerdampak } }, select: { id: true, orderNumber: true, paymentStatus: true, paidAt: true } })).map((o) => [o.id, o]));
  const statusSebelum = await fotoStatus();

  // 3) Alokasi baru (nominal bulat; Σ = amountBaru).
  let alokasiBaru = null; // null = order tunggal tanpa baris alokasi (perilaku lama)
  let autoResi = false;
  if (perubahan.alokasi) {
    alokasiBaru = perubahan.alokasi;
  } else if (adaAlokasiLama) {
    const lamaRows = lama.finAllocations.map((a) => ({ orderId: a.orderId, amount: Math.round(moneyToNumber(a.amount)) }));
    if (amountBaru === lama.amount) alokasiBaru = lamaRows;
    else if (resi) autoResi = true; // dihitung setelah Payment lama dibatalkan, dengan helper kanonis Resi (sisa tagihan per child)
    else {
      const bagi = bagiProporsional(amountBaru, lamaRows.map((r) => r.amount)); // deterministik largest-remainder
      alokasiBaru = lamaRows.map((r, i) => ({ orderId: r.orderId, amount: bagi[i] })).filter((r) => r.amount > 0);
    }
  }
  if (alokasiBaru && alokasiBaru.reduce((s, a) => s + a.amount, 0) !== amountBaru) {
    throw tolak(`Total alokasi ${rupiah(alokasiBaru.reduce((s, a) => s + a.amount, 0))} harus sama dengan nominal pembayaran ${rupiah(amountBaru)}.`, "Sesuaikan nominal tiap baris alokasi.", 400, "TOTAL_ALOKASI_TIDAK_SAMA");
  }

  // 4) Balik semua jurnal aktif Payment lama pada tanggal aslinya.
  const sources = [{ source: "PEMBAYARAN_ORDER", sourceId: paymentId }];
  const sebelum = await snapshotJurnal(tx, sources);
  const jurnalLama = await ambilJurnalAktif(tx, paymentId);
  const akunUM = await tx.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UANG_MUKA_PELANGGAN }, select: { id: true } });
  const akunPiutang = await tx.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA }, select: { id: true } });
  // Periode rekonsiliasi (BELUM selesai) yang tersentuh: rekening+tanggal jurnal lama dan rekening+tanggal jurnal pengganti. Saldo buku SEBELUM dicatat.
  const kasTanggal = [];
  for (const e of jurnalLama) for (const l of e.lines) if (l.cashAccountId) kasTanggal.push({ cashAccountId: l.cashAccountId, date: e.date });
  if (rekTujuan) kasTanggal.push({ cashAccountId: rekTujuan.id, date: toBookDate(createdAtBaru) });
  const kandidat = kasTanggal.length
    ? await tx.finBankStatement.findMany({ where: { status: { not: "SELESAI" }, OR: kasTanggal.map((k) => ({ cashAccountId: k.cashAccountId, periodStart: { lte: k.date }, periodEnd: { gte: k.date } })) }, orderBy: { id: "asc" } })
    : [];
  const saldoPeriodeSebelum = new Map();
  for (const st of kandidat) saldoPeriodeSebelum.set(st.id, await saldoBukuRekening(tx, st.cashAccountId, st.periodEnd));
  const alasanBalik = `Koreksi pembayaran — ${reason}`;
  for (const e of jurnalLama) await reverseJournal(tx, { entryId: e.id, date: e.date, reason: alasanBalik, userId });

  // 5) Payment lama → batal (jejak tetap). Setelah ini paidForOrder tidak lagi memuatnya → validasi sisa tagihan bersih.
  await tx.payment.update({ where: { id: paymentId }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: `Dikoreksi — ${reason}`.slice(0, ALASAN_MAKS) } });
  await tx.finPostingGap.updateMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: paymentId, resolvedAt: null }, data: { resolvedAt: new Date() } }); // gap pembayaran lama tidak relevan lagi — versi pengganti dibukukan sendiri

  // 6) Validasi target: order ada/aktif, aturan Resi, sisa tagihan (toleransi bagian LAMA yang sudah ada agar data lama tetap bisa dikoreksi turun).
  let targets = alokasiBaru ?? [{ orderId: orderIdBaru, amount: amountBaru }];
  if (resi) {
    const { grup, anak } = await muatGrupResi(tx, lama.order.groupId);
    try {
      const { aktif } = pastikanGrupLayak(grup, anak); // anchor dibatalkan / backfill / customer beda → sama dengan alur Resi normal
      if (autoResi) {
        // Nominal berubah tanpa alokasi eksplisit: bagi menurut sisa tagihan kanonis tiap child (Payment lama sudah tidak dihitung), sama dengan pembayaran Resi normal.
        const dibayar = await muatDibayar(tx, aktif);
        const hitung = hitungAlokasiResi({ anak, dibayar, tipe: TIPE_BAYAR.TAGIHAN, nominal: amountBaru, grup });
        alokasiBaru = hitung.tulis.map((a) => ({ orderId: a.orderId, amount: a.alokasi }));
        targets = alokasiBaru;
      }
      await validasiAlokasiResi(tx, { grup, alokasi: targets, nominalPayment: amountBaru });
    } catch (e) {
      if (e instanceof ResiBayarError) throw tolak(e.message, "Sesuaikan alokasi item Resi.", e.statusCode || 409, e.code || "ALOKASI_RESI_DITOLAK");
      throw e;
    }
  } else {
    const orders = await tx.order.findMany({ where: { id: { in: targets.map((t) => t.orderId) } }, select: { ...PILIH_TAGIHAN, orderNumber: true } });
    if (orders.length !== new Set(targets.map((t) => t.orderId)).size) throw new KoreksiError("Ada order tujuan yang tidak ditemukan", 404, "ORDER_TIDAK_ADA");
    const lamaPerOrder = new Map(); // kontribusi Payment lama per order (toleransi)
    if (adaAlokasiLama) for (const a of lama.finAllocations) lamaPerOrder.set(a.orderId, Math.round(moneyToNumber(a.amount)));
    else lamaPerOrder.set(lama.orderId, lama.amount);
    for (const t of targets) {
      const o = orders.find((x) => x.id === t.orderId);
      if (o.status === "CANCELLED") throw tolak(`Order ${o.orderNumber} sudah dibatalkan.`, "Pilih order tujuan yang masih aktif.", 409, "ORDER_DIBATALKAN");
      if (o.groupId && o.group?.source === "BARU") {
        throw tolak(`Order ${o.orderNumber} adalah bagian dari Resi Gabungan.`, "Pembayaran untuk item Resi wajib lewat alur Resi, bukan koreksi order tunggal.", 409, "ANAK_RESI_WAJIB_BAYAR_LEWAT_RESI");
      }
      const sudah = moneyToNumber(await paidForOrder(tx, o.id, GATE_MATI));
      const sisa = Math.max(tagihanOrder(o, o.group) - sudah, 0);
      const batas = Math.max(sisa, lamaPerOrder.get(o.id) ?? 0);
      if (t.amount > batas) throw tolak(`Alokasi ke order ${o.orderNumber} (${rupiah(t.amount)}) melebihi sisa tagihannya (${rupiah(sisa)}).`, "Turunkan nominal atau pilih order lain.", 409, "OVER_ALOKASI");
    }
  }

  // 7) Payment BARU (versi pengganti) + alokasi + verifikasi.
  const baru = await tx.payment.create({
    data: {
      orderId: orderIdBaru, jobId: lama.jobId, amount: amountBaru, method: methodBaru, proofPhotoUrl: lama.proofPhotoUrl, proofPhotoUrls: lama.proofPhotoUrls ?? [],
      cashAccountId: cashBaru ?? null, recordedById: lama.recordedById, createdAt: createdAtBaru,
      referenceNumber: lama.referenceNumber, notes: lama.notes, internalNote: lama.internalNote, replacesPaymentId: lama.id,
    },
  });
  await tx.paymentVerification.create({ data: { paymentId: baru.id, verifiedById: userId } });
  if (alokasiBaru) {
    try {
      await setAllocations(tx, { paymentId: baru.id, allocations: alokasiBaru, userId });
    } catch (e) {
      if (e instanceof AllocationError) throw new KoreksiError(e.message, e.statusCode || 409, "ALOKASI_DITOLAK");
      throw e;
    }
  }

  // 8) Jurnal pengganti (kredit Uang Muka bila belum diakui, Piutang bila sudah — diputuskan postPaymentReceived per order).
  const jurnalBaru = await postPaymentReceived(tx, { paymentId: baru.id, userId });
  if (!jurnalBaru.posted) {
    throw tolak("Jurnal pengganti tidak bisa diposting.", "Periksa pemetaan rekening dan bagan akun di Pengaturan Finance, lalu coba lagi.", 409, "JURNAL_PENGGANTI_GAGAL");
  }

  // 9) True-up Uang Muka ↔ Piutang untuk order (yang tersentuh) yang pendapatannya SUDAH diakui — lihat kepala file.
  const reklas = [];
  if (akunUM && akunPiutang) {
    const sentuh = [...new Set([...idLama, ...idTujuan])].sort();
    for (const orderId of sentuh) {
      const pengakuan = await findEntryByKey(tx, KEY_ORDER.revenue(orderId));
      if (!pengakuan || pengakuan.status !== "POSTED") continue;
      const agg = await tx.finJournalLine.groupBy({
        by: ["accountId"], _sum: { debit: true, credit: true },
        where: { orderId, accountId: { in: [akunUM.id, akunPiutang.id] }, entry: { status: { in: ["POSTED", "REVERSED"] } } },
      });
      const net = (id, sisiPositif) => { // saldo dalam arah normal akun: UM = kredit − debit, Piutang = debit − kredit
        const a = agg.find((x) => x.accountId === id);
        const d = toMoney(a?._sum.debit ?? 0); const c = toMoney(a?._sum.credit ?? 0);
        return sisiPositif === "kredit" ? c.minus(d) : d.minus(c);
      };
      const um = net(akunUM.id, "kredit"); const piutang = net(akunPiutang.id, "debit");
      const r = piutang.minus(um); // > 0: pelanggan masih berutang; < 0: kelebihan bayar
      const target = r.lessThan(0) ? r.negated() : toMoney(0); // Uang Muka kanonis
      const delta = target.minus(um);
      if (delta.equals(0)) continue;
      const ord = await tx.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, customerId: true } });
      const jml = delta.abs();
      const naik = delta.greaterThan(0); // Uang Muka perlu dinaikkan (kredit) ↔ Piutang didebit
      await postJournal(tx, {
        date: pengakuan.date, description: `Penyesuaian Uang Muka/Piutang setelah koreksi pembayaran — ${ord?.orderNumber ?? orderId}`,
        source: "PEMBAYARAN_ORDER", sourceId: baru.id, idempotencyKey: `PEMBAYARAN_ORDER:${baru.id}:RECLAS:${orderId}`, userId,
        lines: [
          { accountId: akunPiutang.id, ...(naik ? { debit: jml } : { credit: jml }), orderId, customerId: ord?.customerId ?? null, description: "Piutang disesuaikan setelah koreksi pembayaran" },
          { accountId: akunUM.id, ...(naik ? { credit: jml } : { debit: jml }), orderId, customerId: ord?.customerId ?? null, description: "Uang muka disesuaikan setelah koreksi pembayaran" },
        ],
      });
      reklas.push({ orderId, jml });
    }
  }

  // 10) Status/paidAt semua order terkait; order yang tersentuh koreksi memakai paidAt efektif (tanggal pembayaran pelunas, bukan waktu koreksi).
  const idSentuh = new Set([...idLama, ...idTujuan]);
  for (const id of idTerdampak) await recomputeOrderPaymentStatus(tx, id, { paidAtEfektif: idSentuh.has(id) });
  const statusSesudah = await fotoStatus();

  const tautan = await tautanJurnal(tx, sebelum, [...sources, { source: "PEMBAYARAN_ORDER", sourceId: baru.id }]);
  const namaRek = async (id) => (id ? (await tx.finCashAccount.findUnique({ where: { id }, select: { name: true } }))?.name ?? "—" : "Rekening standar cara bayar");
  const nomorOrder = async (id) => (await tx.order.findUnique({ where: { id }, select: { orderNumber: true } }))?.orderNumber ?? id;
  const daftarAlokasi = async (rows) => Promise.all(rows.map(async (r) => `${await nomorOrder(r.orderId)}: ${rupiah(r.amount)}`));
  const before = { amount: lama.amount, tanggal: tanggalLama, rekening: lama.cashAccount?.name ?? await namaRek(null), metode: lama.method, order: lama.order.orderNumber };
  const after = { amount: amountBaru, tanggal: tanggalBaru, rekening: await namaRek(cashBaru), metode: methodBaru, order: await nomorOrder(orderIdBaru) };
  const perubahanTampil = { before: {}, after: {} };
  for (const k of Object.keys(after)) if (String(before[k]) !== String(after[k])) { perubahanTampil.before[k] = before[k]; perubahanTampil.after[k] = after[k]; }
  const alokasiLamaTampil = adaAlokasiLama ? await daftarAlokasi(lama.finAllocations.map((a) => ({ orderId: a.orderId, amount: Math.round(moneyToNumber(a.amount)) }))) : [];
  const alokasiBaruTampil = alokasiBaru ? await daftarAlokasi(alokasiBaru) : [];
  if (alokasiLamaTampil.join("|") !== alokasiBaruTampil.join("|")) { perubahanTampil.before.alokasi = alokasiLamaTampil.join("; ") || "order ini saja"; perubahanTampil.after.alokasi = alokasiBaruTampil.join("; ") || "order ini saja"; }

  const dampakStatus = idTerdampak.map((id) => {
    const a = statusSebelum.get(id); const b = statusSesudah.get(id);
    return { orderId: id, nomor: b?.orderNumber ?? a?.orderNumber, statusLama: a?.paymentStatus ?? null, statusBaru: b?.paymentStatus ?? null, paidAtLama: a?.paidAt ?? null, paidAtBaru: b?.paidAt ?? null };
  });

  // 11) Ringkasan periode rekonsiliasi (belum selesai) dihitung ulang; audit pada periode; snapshot final tidak diubah.
  const periodeRekon = [];
  for (const st of kandidat) {
    const sesudah = await saldoBukuRekening(tx, st.cashAccountId, st.periodEnd);
    const snap = await tx.finReconSnapshot.findUnique({ where: { statementId: st.id } });
    const pandangan = snap ? await pandanganCutoff(tx, snap, { closingBank: st.closingBalance }) : null;
    periodeRekon.push({
      statementId: st.id, status: st.status, periodStart: st.periodStart, periodEnd: st.periodEnd, cashAccountId: st.cashAccountId,
      saldoBukuSebelum: moneyToNumber(saldoPeriodeSebelum.get(st.id)), saldoBukuSesudah: moneyToNumber(sesudah),
      selisihBankSesudah: moneyToNumber(toMoney(st.closingBalance).minus(sesudah)), snapshotAda: !!snap, snapshotValid: pandangan ? pandangan.valid : null,
    });
  }

  if (preview) {
    const data = await susunPratinjau(tx, { sebelum, sources: [...sources, { source: "PEMBAYARAN_ORDER", sourceId: baru.id }], perubahan: perubahanTampil });
    throw new PratinjauKoreksi({
      ...data, dampakStatus, alokasiLama: alokasiLamaTampil, alokasiBaru: alokasiBaruTampil,
      reklasUangMuka: reklas.map((r) => ({ orderId: r.orderId, jumlah: moneyToNumber(r.jml) })),
      periodeRekon,
    });
  }

  const meta = { reason, before: perubahanTampil.before, after: perubahanTampil.after, ...tautan };
  await recordActivity(tx, { entityType: ENTITY_TYPES.PAYMENT, entityId: paymentId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { aksi: "koreksi_pembayaran", digantiOleh: baru.id, ...meta } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.PAYMENT, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { aksi: "koreksi_pembayaran", menggantikan: paymentId, ...meta } });
  for (const pr of periodeRekon) {
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: pr.statementId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
      metadata: { label: "Pembayaran dikoreksi setelah periode dibuat", aksi: "pembayaran_dikoreksi", paymentLamaId: paymentId, paymentBaruId: baru.id, reason, ...pr },
    });
  }
  return { ok: true, lamaId: paymentId, baruId: baru.id, dampakStatus, periodeRekon, ...tautan };
}

// ── Riwayat ─────────────────────────────────────────────────────────────────────────────────────────────────────

const LABEL_AKSI = {
  edit_info_pembayaran: "Informasi diubah", koreksi_pembayaran: "Dikoreksi (versi pengganti dibuat)",
};

/** Rantai versi (lama → baru), peristiwa audit, dan rantai jurnal (asli → dibalik → pengganti) untuk satu pembayaran. */
export async function riwayatPembayaran(db, paymentId) {
  const dasar = await db.payment.findUnique({ where: { id: paymentId }, select: { id: true } });
  if (!dasar) throw new KoreksiError("Pembayaran tidak ditemukan", 404);
  const ids = [paymentId];
  let sel = paymentId;
  for (let i = 0; i < 50; i++) { // mundur ke versi paling awal
    const p = await db.payment.findUnique({ where: { id: sel }, select: { replacesPaymentId: true } });
    if (!p?.replacesPaymentId) break;
    ids.unshift(p.replacesPaymentId); sel = p.replacesPaymentId;
  }
  sel = paymentId;
  for (let i = 0; i < 50; i++) { // maju ke versi terbaru
    const p = await db.payment.findUnique({ where: { id: sel }, select: { replacedBy: { select: { id: true } } } });
    if (!p?.replacedBy) break;
    ids.push(p.replacedBy.id); sel = p.replacedBy.id;
  }
  const versi = await db.payment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, amount: true, method: true, createdAt: true, cancelledAt: true, cancelReason: true, replacesPaymentId: true,
      referenceNumber: true, notes: true, internalNote: true, proofPhotoUrl: true,
      cashAccount: { select: { name: true } }, order: { select: { orderNumber: true } },
      finAllocations: { select: { amount: true, order: { select: { orderNumber: true } } } },
      verifications: { select: { createdAt: true, verifiedBy: { select: { name: true } } } },
    },
  });
  const urut = ids.map((id) => versi.find((v) => v.id === id)).filter(Boolean).map((v, i, arr) => ({
    id: v.id, nomorVersi: i + 1, terbaru: i === arr.length - 1,
    status: v.cancelledAt ? (arr[i + 1] ? "DIGANTI" : "DIBATALKAN") : "AKTIF",
    nominal: v.amount, metode: v.method, tanggal: tanggalWIB(v.createdAt), dicatatPada: v.createdAt,
    rekening: v.cashAccount?.name ?? null, order: v.order?.orderNumber ?? null,
    alokasi: v.finAllocations.map((a) => ({ order: a.order?.orderNumber ?? null, nominal: moneyToNumber(a.amount) })),
    verifikasi: v.verifications[0] ? { oleh: v.verifications[0].verifiedBy?.name ?? null, pada: v.verifications[0].createdAt } : null,
    referensi: v.referenceNumber, catatan: v.notes, keteranganInternal: v.internalNote, adaBukti: !!v.proofPhotoUrl,
    alasanBatal: v.cancelledAt ? v.cancelReason : null,
  }));

  const events = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.PAYMENT, entityId: { in: ids } }, orderBy: { createdAt: "asc" } });
  const aktorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
  const aktor = aktorIds.length ? await db.user.findMany({ where: { id: { in: aktorIds } }, select: { id: true, name: true } }) : [];
  const nama = new Map(aktor.map((a) => [a.id, a.name]));
  const peristiwa = events.map((e) => ({
    waktu: e.createdAt, paymentId: e.entityId, aksi: LABEL_AKSI[e.metadata?.aksi] || e.eventType, aktor: nama.get(e.actorId) || "—",
    alasan: e.metadata?.reason ?? null,
    perubahan: Object.keys(e.metadata?.after || {}).map((field) => ({ field, lama: e.metadata.before?.[field] ?? null, baru: e.metadata.after[field] })),
    jurnalDibalik: e.metadata?.jurnalDibalik ?? [], jurnalPengganti: e.metadata?.jurnalPengganti ?? [],
  })).filter((e) => e.alasan || e.perubahan.length);

  const entries = await db.finJournalEntry.findMany({
    where: { source: "PEMBAYARAN_ORDER", sourceId: { in: ids } },
    include: { reversalOf: { select: { entryNumber: true } }, reversedBy: { select: { entryNumber: true, reversalReason: true } } },
    orderBy: { createdAt: "asc" },
  });
  const balikan = entries.length
    ? await db.finJournalEntry.findMany({ where: { reversalOfId: { in: entries.map((e) => e.id) } }, include: { reversalOf: { select: { entryNumber: true } } } })
    : [];
  const jurnal = [...entries, ...balikan].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map((e) => ({
    id: e.id, nomor: e.entryNumber, tanggal: e.date, deskripsi: e.description, status: e.status,
    membalikJurnal: e.reversalOf?.entryNumber ?? null, dibalikOleh: e.reversedBy?.entryNumber ?? null,
    alasanBalik: e.reversalReason || e.reversedBy?.reversalReason || null,
  }));
  return { versi: urut, peristiwa, jurnal };
}
