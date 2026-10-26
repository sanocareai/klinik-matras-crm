// KOREKSI SALDO PER BAHAN dari Stok & Lokasi (Okt 2026).
// Pengguna mengisi JUMLAH FISIK yang benar + alasan. Sistem menampilkan pratinjau (saldo sebelum, jumlah baru, selisih, dampak stok, izin) lalu MENGAJUKAN permintaan Penyesuaian Stok resmi
// (stock_adjustment_requests): status Menunggu persetujuan -> disetujui ORANG LAIN (Owner/Finance) -> diposting lewat postStockMovement (SATU-SATUNYA penulis ledger). Tidak ada penimpaan saldo.
// File ini TIDAK menulis stock_movements, harga berlaku, biaya operasional, valuasi Finance, jurnal, maupun GL. Konteks pengajuan disimpan di koreksi_saldo_bahan (append-only):
// saldo yang DILIHAT pengaju dipakai untuk menolak persetujuan/posting bila saldo sudah bergeser (wajibSaldoBelumBergeser).
import crypto from "node:crypto";
import { computeStockSnapshot, lockMaterialBalance } from "./inventoryLedger.js";
import { keadaanStok, LABEL_KEADAAN } from "./stokLokasi.js";
import { KEADAAN_SALDO, LABEL_KEADAAN_SALDO, klasifikasiSaldo, nolTerverifikasiPer } from "./keadaanSaldo.js";
import { validasiAsalKoreksi, ASAL_KOREKSI_TIPE } from "./asalKoreksiSaldo.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export class KoreksiSaldoError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) { super(message); this.statusCode = statusCode; this.code = code; this.detail = detail; }
}
const wajib = (c, m, code, status = 400, detail = null) => { if (!c) throw new KoreksiSaldoError(m, status, code, detail); };
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const EPS = 1e-6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 32);

export { KEADAAN_SALDO, LABEL_KEADAAN_SALDO, klasifikasiSaldo, nolTerverifikasiPer };
// Status permintaan penyesuaian -> teks pengguna.
export const STATUS_TEKS = Object.freeze({
  DRAFT: "Draf", WAITING_APPROVAL: "Menunggu persetujuan orang lain", APPROVED: "Disetujui — menunggu posting", POSTED: "Sudah diposting ke stok", CANCELLED: "Dibatalkan", REJECTED: "Ditolak",
});
const AKTIF = ["DRAFT", "WAITING_APPROVAL", "APPROVED"];

async function dasarBahan(db, materialId) {
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const m = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
  wajib(m, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const [snap] = (await computeStockSnapshot(db)).filter((x) => x.materialId === materialId);
  const [{ n }] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  const verif = (await nolTerverifikasiPer(db, materialId)).get(materialId) ?? null;
  const saldo = r4(snap?.balance ?? 0); const dipesan = r4(snap?.reserved ?? 0);
  const keadaan = klasifikasiSaldo({ jumlahPergerakan: n, saldo, nolTerverifikasi: !!verif });
  return { m, saldo, dipesan, tersedia: r4(saldo - dipesan), jumlahPergerakan: n, verif, keadaan, reorderPoint: snap?.reorderPoint ?? null, active: m.active };
}

const statusStok = (d, saldo, tersedia, n) => keadaanStok({ active: d.active, balance: saldo, available: tersedia, reorderPoint: d.reorderPoint, jumlahPergerakan: n });

function bacaJumlahFisik(v) {
  wajib(v !== undefined && v !== null && String(v).trim() !== "", "Jumlah fisik yang benar wajib diisi (isi 0 bila memang kosong)", "JUMLAH_WAJIB");
  const x = Number(v);
  wajib(Number.isFinite(x), "Jumlah fisik harus angka", "JUMLAH_TIDAK_VALID");
  wajib(x >= 0, "Jumlah fisik tidak boleh minus — fisik tidak bisa kurang dari nol", "JUMLAH_MINUS");
  wajib(x <= 10_000_000, "Jumlah fisik tidak masuk akal (maksimum 10.000.000)", "JUMLAH_TERLALU_BESAR");
  wajib(Math.abs(r4(x) - x) < 1e-9, "Jumlah fisik maksimum 4 angka di belakang koma", "DESIMAL_BERLEBIH");
  return r4(x);
}

export function izinKoreksi(user) {
  const mengajukan = hasPermission(user, P.INVENTORY_WRITE); const menyetujui = hasPermission(user, P.INVENTORY_ADJUSTMENT_APPROVE);
  return {
    bolehMengajukan: mengajukan, bolehMenyetujui: menyetujui,
    teks: mengajukan
      ? "Anda boleh mengajukan koreksi saldo. Stok baru berubah setelah DISETUJUI orang lain berperan penyetuju (Owner atau Finance) dan diposting — Anda tidak dapat menyetujui koreksi Anda sendiri."
      : "Akun Anda hanya dapat melihat. Mengajukan koreksi saldo: peran Gudang, Admin, atau Owner (izin inventory:write). Menyetujui: Owner atau Finance (orang lain dari pengaju).",
  };
}

export const DAMPAK_DATA = Object.freeze({
  ditulisSaatAjukan: ["1 permintaan Penyesuaian Stok (status Menunggu persetujuan) dengan nomor ADJ-…", "1 catatan konteks koreksi (saldo yang Anda lihat, jumlah fisik, keadaan saldo)"],
  ditulisSaatPosting: ["1 pergerakan stok jenis ADJUSTMENT sebesar selisih (lewat postStockMovement, jalur resmi) — baru terjadi setelah disetujui orang lain dan diposting"],
  tidakDisentuh: ["Harga Berlaku dan riwayat harga", "HPP operasional pemakaian lama (snapshot beku order tidak berubah)", "Nilai persediaan/valuasi Finance, jurnal, dan GL (tidak ada jurnal otomatis dari penyesuaian)", "Pergerakan stok lain yang sudah ada (tidak ada yang ditimpa)"],
});

/** Pratinjau (baca-saja): saldo sebelum, jumlah baru, selisih, dampak stok, izin. Tidak menulis apa pun. */
export async function pratinjauKoreksi(db, user, { materialId, jumlahFisik } = {}) {
  const fisik = bacaJumlahFisik(jumlahFisik);
  const d = await dasarBahan(db, materialId);
  const selisih = r4(fisik - d.saldo); const adaSelisih = Math.abs(selisih) > EPS;
  const saldoSesudah = fisik; const tersediaSesudah = r4(fisik - d.dipesan); const nSesudah = d.jumlahPergerakan + (adaSelisih ? 1 : 0);
  const peringatan = [];
  if (d.keadaan === KEADAAN_SALDO.BELUM_ADA_CATATAN) peringatan.push(adaSelisih ? "Bahan ini BELUM punya catatan stok. Koreksi ini akan menjadi catatan stok pertamanya (penyesuaian), bukan perbaikan angka yang sudah ada." : "Bahan belum punya catatan stok; jumlah fisik 0 tidak menciptakan catatan apa pun (saldo tetap 'belum diketahui').");
  if (d.keadaan === KEADAAN_SALDO.NOL_MENURUT_PERGERAKAN && !adaSelisih) peringatan.push("Saldo 0 ini baru 'nol menurut pergerakan'. Tanpa selisih tidak ada yang bisa dicatat di sini; verifikasi nol resmi lewat Stock Count.");
  if (d.keadaan === KEADAAN_SALDO.MINUS) peringatan.push(`Catatan saat ini MINUS (${d.saldo}). Koreksi menaikkan saldo catatan menjadi ${fisik} — pastikan ${fisik} adalah hasil hitung fisik, bukan perkiraan.`);
  if (adaSelisih && d.dipesan > EPS && tersediaSesudah < -EPS) peringatan.push(`Setelah koreksi, jumlah Tersedia menjadi ${tersediaSesudah} karena ${d.dipesan} sudah dipesan (Material Issue/reservasi). Pesanan itu tidak ikut berubah.`);
  if (adaSelisih && d.saldo > EPS && Math.abs(selisih) > d.saldo * 0.5) peringatan.push(`Selisih besar (${selisih > 0 ? "+" : ""}${selisih} dari saldo ${d.saldo}). Periksa ulang hitungan sebelum mengajukan.`);
  const aktif = await db.koreksiSaldoBahan.findFirst({ where: { materialId, adjustmentRequest: { status: { in: AKTIF } } }, include: { adjustmentRequest: { select: { adjustmentNumber: true, status: true } } } });
  const izin = izinKoreksi(user);
  const dapatDiajukan = izin.bolehMengajukan && adaSelisih && !aktif;
  return {
    bahan: { id: d.m.id, kode: d.m.code, nama: d.m.name, satuan: d.m.unit, aktif: d.active },
    keadaanSaldo: d.keadaan, keadaanTeks: LABEL_KEADAAN_SALDO[d.keadaan], verifikasiNol: d.verif,
    jumlahPergerakan: d.jumlahPergerakan,
    saldoSebelum: d.jumlahPergerakan > 0 || d.verif ? d.saldo : null, // null = belum diketahui (bukan nol)
    saldoDilihat: d.saldo, jumlahFisik: fisik, selisih, arah: !adaSelisih ? "TANPA_SELISIH" : selisih > 0 ? "NAIK" : "TURUN",
    dampakStok: {
      onHand: { sebelum: d.saldo, sesudah: saldoSesudah }, dipesan: d.dipesan, tersedia: { sebelum: d.tersedia, sesudah: tersediaSesudah },
      keadaanSebelum: LABEL_KEADAAN[statusStok(d, d.saldo, d.tersedia, d.jumlahPergerakan)], keadaanSesudah: LABEL_KEADAAN[statusStok(d, saldoSesudah, tersediaSesudah, nSesudah)],
      catatan: "Angka 'sesudah' berlaku HANYA bila koreksi disetujui orang lain dan diposting; sebelum itu stok tidak berubah.",
    },
    dampakData: DAMPAK_DATA, peringatan, izin,
    pengajuanAktif: aktif ? { nomor: aktif.adjustmentRequest.adjustmentNumber, status: aktif.adjustmentRequest.status, statusTeks: STATUS_TEKS[aktif.adjustmentRequest.status] } : null,
    dapatDiajukan,
    alasanTidakDapat: !izin.bolehMengajukan ? "Akun tanpa izin mengajukan" : !adaSelisih ? "Jumlah fisik sama dengan saldo catatan — tidak ada selisih" : aktif ? `Sudah ada koreksi saldo ${aktif.adjustmentRequest.adjustmentNumber} yang belum selesai` : null,
    hash: sha({ m: materialId, saldo: d.saldo, fisik }),
  };
}

const kunciValid = (k) => { const s = String(k ?? "").trim(); wajib(s.length >= 8 && s.length <= 120, "Idempotency-Key wajib (8–120 karakter) agar klik ganda tidak membuat dua pengajuan", "KUNCI_WAJIB"); return s; };
const tampilHasil = (req, h, ulang) => ({ ulang, id: req.id, nomor: req.adjustmentNumber, status: req.status, statusTeks: STATUS_TEKS[req.status], jumlahFisik: Number(h.jumlahFisik), saldoDilihat: Number(h.saldoDilihat), selisih: Number(h.selisih), keadaanAwal: h.keadaanAwal, bahanId: h.materialId, satuan: h.satuan });

/**
 * Ajukan koreksi saldo. Satu transaksi di bawah kunci bahan: saldo yang DILIHAT pengaju harus sama dengan saldo ledger saat ini (bila tidak: 409 SALDO_BERGESER, tidak ada yang tersimpan);
 * satu pengajuan aktif per bahan; Idempotency-Key mencegah klik ganda. Hasil = permintaan Penyesuaian Stok berstatus Menunggu persetujuan — stok TIDAK berubah.
 */
export async function ajukanKoreksi(prisma, user, { materialId, jumlahFisik, saldoDilihat, alasan, catatan = null, originType = null, originId = null } = {}, kunciMentah) {
  wajib(user?.id, "Pelaku wajib ada", "PELAKU_WAJIB", 401);
  wajib(hasPermission(user, P.INVENTORY_WRITE), "Akun Anda tidak berizin mengajukan koreksi saldo (butuh inventory:write)", "TANPA_IZIN", 403);
  const kunci = kunciValid(kunciMentah);
  const fisik = bacaJumlahFisik(jumlahFisik);
  const teksAlasan = String(alasan ?? "").trim(); wajib(teksAlasan.length >= 5 && teksAlasan.length <= 500, "Alasan wajib diisi (5–500 karakter)", "ALASAN_WAJIB");
  wajib(saldoDilihat !== undefined && saldoDilihat !== null && Number.isFinite(Number(saldoDilihat)), "Saldo yang Anda lihat di pratinjau wajib dikirim (lihat pratinjau dulu)", "PRATINJAU_WAJIB");
  wajib(Boolean(originType) === Boolean(originId), "originType dan originId harus diisi bersamaan", "ASAL_TIDAK_LENGKAP");
  if (originType) { wajib(ASAL_KOREKSI_TIPE.includes(originType), "originType tidak dikenal", "ASAL_TIDAK_DIKENAL"); await validasiAsalKoreksi(prisma, { originType, originId, materialId }); }
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const saldo = r4(await lockMaterialBalance(tx, materialId)); // kunci bahan: serentak diserialkan
        const ada = await tx.koreksiSaldoBahan.findUnique({ where: { idempotencyKey: kunci }, include: { adjustmentRequest: true } });
        if (ada) { wajib(ada.materialId === materialId && Math.abs(Number(ada.jumlahFisik) - fisik) < EPS, "Idempotency-Key ini sudah dipakai untuk koreksi lain", "KUNCI_DIPAKAI_LAIN", 409); return tampilHasil(ada.adjustmentRequest, ada, true); }
        const m = await tx.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, unit: true } }); wajib(m, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
        wajib(Math.abs(saldo - r4(saldoDilihat)) <= EPS, `Saldo bahan sudah bergeser: pratinjau Anda memakai ${r4(saldoDilihat)}, saldo sekarang ${saldo}. Buka pratinjau lagi dari saldo terbaru; tidak ada yang tersimpan.`, "SALDO_BERGESER", 409, { saldoDilihat: r4(saldoDilihat), saldoSekarang: saldo });
        const selisih = r4(fisik - saldo); wajib(Math.abs(selisih) > EPS, "Jumlah fisik sama dengan saldo catatan — tidak ada selisih untuk dikoreksi", "TIDAK_ADA_SELISIH", 409);
        const aktif = await tx.koreksiSaldoBahan.findFirst({ where: { materialId, adjustmentRequest: { status: { in: AKTIF } } }, include: { adjustmentRequest: { select: { adjustmentNumber: true } } } });
        wajib(!aktif, `Sudah ada koreksi saldo ${aktif?.adjustmentRequest.adjustmentNumber} untuk bahan ini yang belum selesai — setujui/batalkan dulu`, "SUDAH_ADA_PENGAJUAN_AKTIF", 409);
        const [{ n }] = await tx.$queryRaw`SELECT COUNT(*)::int AS n FROM stock_movements WHERE material_id = ${materialId}::uuid`;
        const verif = (await nolTerverifikasiPer(tx, materialId)).get(materialId) ?? null;
        const keadaan = klasifikasiSaldo({ jumlahPergerakan: n, saldo, nolTerverifikasi: !!verif });
        const hari = new Date(); const awal = new Date(Date.UTC(hari.getUTCFullYear(), hari.getUTCMonth(), hari.getUTCDate()));
        const urut = (await tx.stockAdjustmentRequest.count({ where: { createdAt: { gte: awal } } })) + 1 + percobaan;
        const nomor = `ADJ-${String(hari.getUTCDate()).padStart(2, "0")}${String(hari.getUTCMonth() + 1).padStart(2, "0")}${String(hari.getUTCFullYear()).slice(-2)}-${String(urut).padStart(2, "0")}`;
        const req = await tx.stockAdjustmentRequest.create({ data: {
          adjustmentNumber: nomor, adjustmentType: "DATA_CORRECTION", materialId, beforeQty: saldo, adjustmentQty: selisih, reason: teksAlasan, notes: catatan ? String(catatan).slice(0, 500) : null,
          status: "WAITING_APPROVAL", requestedById: user.id, originType: originType || null, originId: originId ? String(originId) : null,
        } });
        const h = await tx.koreksiSaldoBahan.create({ data: { adjustmentRequestId: req.id, materialId, satuan: m.unit, jumlahFisik: String(fisik), saldoDilihat: String(saldo), selisih: String(selisih), keadaanAwal: keadaan, jumlahPergerakanAwal: n, idempotencyKey: kunci, createdById: user.id } });
        return tampilHasil(req, h, false);
      }, { timeout: 20_000, maxWait: 10_000 });
    } catch (e) {
      if (e?.code === "P2002" && String(e.meta?.target ?? "").includes("adjustment_number")) continue; // nomor bentrok dengan bahan lain yang serentak: ulangi dengan urutan berikutnya
      throw e;
    }
  }
  throw new KoreksiSaldoError("Gagal membuat nomor penyesuaian setelah beberapa percobaan — coba lagi", 503, "NOMOR_BENTROK");
}

/**
 * Penjaga untuk jalur resmi (persetujuan & posting): bila permintaan ini berasal dari Koreksi Saldo, saldo ledger SEKARANG harus sama dengan saldo yang dilihat pengaju.
 * Dipanggil di dalam transaksi pemanggil. Penyesuaian lain (tanpa konteks ini) TIDAK terpengaruh.
 */
export async function wajibSaldoBelumBergeser(tx, requestId, materialId) {
  const h = await tx.koreksiSaldoBahan.findUnique({ where: { adjustmentRequestId: requestId } });
  if (!h) return null;
  const saldo = r4(await lockMaterialBalance(tx, materialId));
  if (Math.abs(saldo - Number(h.saldoDilihat)) > EPS) {
    throw new KoreksiSaldoError(`Saldo bahan sudah bergeser sejak koreksi diajukan (dilihat ${Number(h.saldoDilihat)}, sekarang ${saldo}). Koreksi ini tidak dapat dilanjutkan: batalkan lalu ajukan ulang dari saldo terbaru.`, 409, "SALDO_BERGESER", { saldoDilihat: Number(h.saldoDilihat), saldoSekarang: saldo });
  }
  return h;
}

/** Konteks koreksi saldo untuk halaman detail Penyesuaian Stok (penyetuju harus melihat jumlah fisik yang dinyatakan, saldo yang dilihat pengaju, dan apakah saldo sudah bergeser). null bila bukan koreksi saldo. Baca-saja. */
export async function konteksKoreksiRequest(db, requestId, status) {
  const h = await db.koreksiSaldoBahan.findUnique({ where: { adjustmentRequestId: requestId } });
  if (!h) return null;
  const [{ saldo }] = await db.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS saldo FROM stock_movements WHERE material_id = ${h.materialId}::uuid`;
  const aktif = AKTIF.includes(status); const bergeser = aktif && Math.abs(r4(saldo) - Number(h.saldoDilihat)) > EPS;
  return {
    jumlahFisik: Number(h.jumlahFisik), saldoDilihat: Number(h.saldoDilihat), selisih: Number(h.selisih), satuan: h.satuan, keadaanAwal: h.keadaanAwal, keadaanAwalTeks: LABEL_KEADAAN_SALDO[h.keadaanAwal],
    saldoSekarang: r4(saldo), kedaluwarsa: bergeser,
    kedaluwarsaTeks: bergeser ? `Saldo sudah bergeser (dilihat ${Number(h.saldoDilihat)}, sekarang ${r4(saldo)}) — tidak dapat disetujui/diposting; batalkan dan ajukan ulang dari saldo terbaru.` : null,
  };
}

/** Riwayat koreksi saldo satu bahan (baru → lama), termasuk yang masih menunggu, dibatalkan, dan KEDALUWARSA (saldo bergeser). Baca-saja. */
export async function riwayatKoreksiBahan(db, materialId, { limit = 30 } = {}) {
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const [{ saldo }] = await db.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS saldo FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  const baris = await db.koreksiSaldoBahan.findMany({ where: { materialId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(limit) || 30, 1), 100),
    include: { adjustmentRequest: { include: { requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, postedBy: { select: { name: true } }, movements: { select: { id: true, qty: true, createdAt: true }, take: 1 } } } } });
  return baris.map((h) => {
    const r = h.adjustmentRequest; const aktif = AKTIF.includes(r.status);
    return {
      id: r.id, nomor: r.adjustmentNumber, status: r.status, statusTeks: STATUS_TEKS[r.status] ?? r.status,
      jumlahFisik: Number(h.jumlahFisik), saldoDilihat: Number(h.saldoDilihat), selisih: Number(h.selisih), satuan: h.satuan, keadaanAwal: h.keadaanAwal, keadaanAwalTeks: LABEL_KEADAAN_SALDO[h.keadaanAwal],
      alasan: r.reason, catatan: r.notes, rujukan: r.originType ? { tipe: r.originType, id: r.originId } : null,
      diajukanOleh: r.requestedBy?.name ?? null, diajukanPada: r.createdAt, disetujuiOleh: r.approvedBy?.name ?? null, disetujuiPada: r.approvedAt, dipostingOleh: r.postedBy?.name ?? null, dipostingPada: r.postedAt,
      pergerakan: r.movements[0] ? { id: r.movements[0].id, qty: Number(r.movements[0].qty), waktu: r.movements[0].createdAt } : null,
      kedaluwarsa: aktif && Math.abs(r4(saldo) - Number(h.saldoDilihat)) > EPS,
      kedaluwarsaTeks: aktif && Math.abs(r4(saldo) - Number(h.saldoDilihat)) > EPS ? `Saldo sudah bergeser (dilihat ${Number(h.saldoDilihat)}, sekarang ${r4(saldo)}) — tidak dapat disetujui/diposting; batalkan dan ajukan ulang.` : null,
    };
  });
}

/** Keadaan saldo + ringkasan untuk drawer (baca-saja). */
export async function keadaanBahan(db, user, materialId) {
  const d = await dasarBahan(db, materialId);
  return { bahan: { id: d.m.id, kode: d.m.code, nama: d.m.name, satuan: d.m.unit }, keadaanSaldo: d.keadaan, keadaanTeks: LABEL_KEADAAN_SALDO[d.keadaan], saldo: d.jumlahPergerakan > 0 || d.verif ? d.saldo : null, jumlahPergerakan: d.jumlahPergerakan, verifikasiNol: d.verif, dipesan: d.dipesan, tersedia: d.tersedia, izin: izinKoreksi(user) };
}
