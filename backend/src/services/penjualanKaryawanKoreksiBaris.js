// KOREKSI BARIS PENJUALAN (Finance + operasional ATOMIK) untuk Penjualan Karyawan terpadu.
//
// Baris item penjualan adalah sumber kanonis; koreksinya mengubah SEKALIGUS, dalam satu transaksi:
//   • Finance   : jumlah/harga/nama baris -> total PKR -> jurnal (jurnal berlaku dibalik, jurnal pengganti diposting; pembayaran aktif tidak boleh melebihi total baru),
//   • Order CRM : item operasional (jumlah, ukuran, spesifikasi, dikirim/diambil, tambah/hapus) lewat penjualanKaryawanKoreksi.js yang sudah ada,
//   • Produksi  : unit dibuat/dibatalkan sesuai jumlah (hanya unit yang belum dijadwalkan/diproses).
// Gagal di mana pun = tidak ada yang berubah (transaksi pemanggil dibatalkan; trigger DB tertunda menjaga jumlah/nama tetap sama di dua sisi).
//
// Aturan setelah Produksi/Delivery berjalan (keputusan Owner):
//   • perubahan HARGA (administratif) tetap boleh — hanya menyentuh sisi Finance (aturan PKR yang ada: nilai tidak boleh di bawah pembayaran aktif; periode jurnal harus terbuka),
//   • jumlah/produk/ukuran/spesifikasi/dikirim DIBLOKIR (ITEM_TERKUNCI) dengan arahan pembatalan resmi.
// Harga tidak pernah dikirim ke sisi operasional: operasi yang diterjemahkan ke penjualanKaryawanKoreksi.js tidak memuat harga, dan ledger revisi menyimpan angka uang hanya di
// kolom finance_before/finance_after (hanya dibaca endpoint Finance).
import { createHash } from "node:crypto";
import { PkrOrderError } from "./pkrGuard.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { toMoney, sumMoney, moneyToNumber } from "./finance/money.js";
import { hitungItems, subtotalItem } from "./finance/penjualanKaryawanManual.js";
import { koreksiJurnalPenjualan } from "./finance/posting/penjualanKaryawan.js";
import { terapkanKoreksi, hitungKoreksi } from "./penjualanKaryawanKoreksi.js";
import { siapkanTerpadu, dataBaris } from "./penjualanKaryawanTerpadu.js";
import { ItemPkrError } from "../lib/domain/pkrItem.js";
import { PenjualanItemError, punyaUnit } from "../lib/domain/pkrPenjualanItem.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const MAKS_OPERASI = 30;

const FIELD_OPS_BIASA = ["jumlah", "harga", "nama", "produkId", "panjang", "lebar", "tebal", "tinggi", "spesifikasi", "perluDikirim"];
const FIELD_OPS_SET = ["jumlah", "harga", "perluDikirim"];
const FIELD_NON_OPS = ["jumlah", "harga", "nama", "spesifikasi"];
const FIELD_KE_OPERASI = ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "perluDikirim"];

const noBaris = (i) => i.sortOrder + 1;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const errBaris = (m) => gagal(m, 400, "HARGA_JUMLAH_TIDAK_VALID");

/** Muat PKR + baris + item operasional aktif. Order operasional WAJIB ada (koreksi memakai buku revisi per order). */
async function muat(tx, penjualanId, { kunci }) {
  if (!UUID.test(String(penjualanId))) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await tx.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId },
    include: { items: { orderBy: { sortOrder: "asc" } }, payments: { where: { cancelledAt: null }, select: { amount: true } }, orderCrm: { select: { id: true, orderNumber: true } } },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (pkr.status !== "AKTIF") throw gagal(`${pkr.nomor} sudah dibatalkan — tidak bisa dikoreksi`, 409, "SUDAH_DIBATALKAN");
  if (!pkr.orderCrm) {
    throw gagal(`${pkr.nomor} tidak punya order operasional (semua item tanpa Produksi/Pickup, atau order belum dibuat). Koreksi baris belum tersedia — batalkan lalu catat ulang.`, 409, "BELUM_ADA_ORDER");
  }
  const rows = await tx.pkrOrderItem.findMany({ where: { orderId: pkr.orderCrm.id, removedAt: null }, orderBy: { seq: "asc" } });
  return { pkr, rows };
}

function bacaOperasi(operasi) {
  if (!Array.isArray(operasi) || operasi.length === 0) throw gagal("Pilih minimal satu perubahan item", 400, "OPERASI_KOSONG");
  if (operasi.length > MAKS_OPERASI) throw gagal(`Maksimal ${MAKS_OPERASI} perubahan per koreksi`, 400, "OPERASI_TERLALU_BANYAK");
  return operasi.map((o, i) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) throw gagal(`Perubahan ${i + 1}: isian tidak valid`, 400, "OPERASI_TIDAK_VALID");
    if (!["ubah", "hapus", "tambah"].includes(o.op)) throw gagal(`Perubahan ${i + 1}: jenis harus ubah, hapus, atau tambah`, 400, "OPERASI_TIDAK_VALID");
    if (o.op !== "tambah" && !Number.isInteger(Number(o.no))) throw gagal(`Perubahan ${i + 1}: nomor item wajib`, 400, "OPERASI_TIDAK_VALID");
    if (o.op === "tambah" && (!o.item || typeof o.item !== "object" || Array.isArray(o.item))) throw gagal(`Perubahan ${i + 1}: isian item baru wajib`, 400, "OPERASI_TIDAK_VALID");
    return { ...o, no: o.op === "tambah" ? null : Number(o.no) };
  });
}

const snapBaris = (i) => ({
  no: noBaris(i), nama: i.name, jumlah: Number(i.quantity), harga: moneyToNumber(toMoney(i.unitPrice)), subtotal: moneyToNumber(subtotalItem(i.unitPrice, i.quantity)),
  pemenuhan: i.fulfillment ?? null, kategori: i.categoryCode ?? null, perluDikirim: i.perluDikirim ?? null,
});

/**
 * Rencana koreksi: terjemahkan operasi baris penjualan menjadi (a) operasi operasional untuk penjualanKaryawanKoreksi.js dan (b) perubahan Finance. TIDAK menulis.
 * @returns {{ pkr, rows, opsOperasional: object[], ubahBaris: Map, hapusBaris: object[], tambah: object|null, totalLama, totalBaru, terbayar, barisSesudah: object[] }}
 */
async function rencanakan(tx, { pkr, rows, operasi }) {
  const byNo = new Map(pkr.items.map((i) => [noBaris(i), i]));
  const ops = bacaOperasi(operasi);
  const opsOperasional = []; const ubahBaris = new Map(); const hapusBaris = []; const tambahRaw = [];
  const dihapus = new Set();
  const rowsBaris = (b) => rows.filter((r) => r.saleItemId === b.id);

  for (const op of ops) {
    if (op.op === "tambah") { tambahRaw.push(op.item); continue; }
    const b = byNo.get(op.no);
    if (!b) throw gagal(`Item ${op.no} tidak ditemukan atau sudah dihapus`, 404, "ITEM_TIDAK_ADA");
    if (b.fulfillment == null) throw gagal(`Item ${op.no} berasal dari catatan lama (tanpa data pemenuhan) — tidak bisa dikoreksi di sini. Batalkan lalu catat ulang bila perlu.`, 409, "KOREKSI_ORDER_LAMA");
    if (dihapus.has(b.id)) throw gagal(`Item ${op.no} sudah ditandai dihapus pada permintaan yang sama`, 400, "OPERASI_BERTENTANGAN");
    const baris = rowsBaris(b);
    const set = baris.some((r) => r.bundleNo != null);
    if (op.op === "hapus") {
      dihapus.add(b.id); hapusBaris.push(b);
      for (const r of baris) opsOperasional.push({ op: "hapus", no: r.seq });
      continue;
    }
    // ubah
    if (op.kategori !== undefined || op.pemenuhan !== undefined) throw gagal(`Item ${op.no}: kategori dan cara pemenuhan tidak bisa diubah — hapus item lalu tambahkan item baru`, 409, "KATEGORI_TIDAK_BISA_DIUBAH");
    const diizinkan = !punyaUnit(b.fulfillment) ? FIELD_NON_OPS : set ? FIELD_OPS_SET : FIELD_OPS_BIASA;
    const dikirim = Object.keys(op).filter((k) => !["op", "no"].includes(k));
    const asing = dikirim.filter((k) => !diizinkan.includes(k));
    if (asing.length) {
      throw gagal(`Item ${op.no}: ${asing.join(", ")} tidak bisa diubah di sini${set ? " (komponen Set — ukuran/spesifikasi per komponen lewat \"Lengkapi spesifikasi order\")" : ""}`, 400, "FIELD_TIDAK_DIIZINKAN");
    }
    const u = ubahBaris.get(b.id) ?? { baris: b, perubahan: {} };
    for (const k of dikirim) u.perubahan[k] = op[k];
    ubahBaris.set(b.id, u);

    if (punyaUnit(b.fulfillment)) {
      const barisJumlah = op.jumlah !== undefined ? Number(op.jumlah) : null;
      if (barisJumlah !== null && (!Number.isInteger(barisJumlah) || barisJumlah < 1)) throw gagal(`Item ${op.no}: jumlah harus bilangan bulat ≥ 1`, 400, "JUMLAH_HARUS_BULAT");
      if (set) {
        for (const r of baris) {
          const o = { op: "ubah", no: r.seq };
          if (barisJumlah !== null) o.jumlah = barisJumlah * (r.componentQty ?? 1);
          if (op.perluDikirim !== undefined) o.perluDikirim = op.perluDikirim;
          if (Object.keys(o).length > 2) opsOperasional.push(o);
        }
      } else if (baris[0]) {
        const o = { op: "ubah", no: baris[0].seq };
        for (const k of ["jumlah", ...FIELD_KE_OPERASI]) if (op[k] !== undefined) o[k] = op[k];
        if (op.nama !== undefined) { o.produkNama = op.nama; o.produkId = null; }
        if (op.produkId !== undefined) { o.produkId = op.produkId; delete o.produkNama; }
        if (Object.keys(o).length > 2) opsOperasional.push(o);
      }
    }
  }

  // Item baru: baris Finance + item operasional dari masukan yang SAMA.
  let tambah = null;
  if (tambahRaw.length) {
    const urut = Math.max(...pkr.items.map((i) => i.sortOrder), -1) + 1;
    tambah = await siapkanTerpadu(tx, tambahRaw, { nomorBarisAwal: urut + 1, validasiHimpunan: false });
    if (tambah.opItems.length) opsOperasional.push({ op: "tambah", siap: tambah.opItems });
  }

  // Himpunan baris sesudah koreksi -> total (SATU aturan hitung uang yang sama dengan pembuatan).
  const akhir = [];
  for (const b of pkr.items) {
    if (dihapus.has(b.id)) continue;
    const u = ubahBaris.get(b.id)?.perubahan ?? {};
    akhir.push({ id: b.id, name: u.nama !== undefined ? String(u.nama).trim() : b.name, quantity: u.jumlah !== undefined ? u.jumlah : String(b.quantity), unitPrice: u.harga !== undefined ? u.harga : String(b.unitPrice), baru: false });
  }
  for (const nb of tambah?.baris ?? []) akhir.push({ id: nb.id, name: nb.name, quantity: String(nb.quantity), unitPrice: String(nb.unitPrice), baru: true });
  if (akhir.length === 0) throw gagal("Koreksi ini menghapus semua item. Bila penjualan memang batal, batalkan Penjualan Karyawan-nya.", 409, "SEMUA_ITEM_DIHAPUS");
  const hitung = hitungItems(akhir.map((a) => ({ name: a.name, quantity: a.quantity, unitPrice: a.unitPrice })), errBaris);
  const totalBaru = hitung.total;
  const totalLama = toMoney(pkr.total);
  const terbayar = pkr.payments.length ? sumMoney(pkr.payments.map((p) => p.amount)) : toMoney(0);
  if (totalBaru.lessThan(terbayar)) {
    throw gagal(`Total baru Rp${Number(totalBaru).toLocaleString("id-ID")} lebih kecil dari pembayaran yang sudah diterima Rp${Number(terbayar).toLocaleString("id-ID")}. Batalkan pembayarannya dulu (atau koreksi lebih kecil).`, 409, "TOTAL_DI_BAWAH_PEMBAYARAN");
  }
  const barisSesudah = akhir.map((a, i) => ({ id: a.id, baru: a.baru, nama: a.name, jumlah: Number(hitung.items[i].quantity), harga: moneyToNumber(hitung.items[i].unitPrice), subtotal: moneyToNumber(hitung.items[i].subtotal) }));
  return { pkr, rows, opsOperasional, ubahBaris, hapusBaris, tambah, totalLama, totalBaru, terbayar, barisSesudah, hitung };
}

function dampakKeuangan(r) {
  const lama = new Map(r.pkr.items.map((i) => [i.id, snapBaris(i)]));
  const perubahan = [];
  for (const s of r.barisSesudah) {
    const a = lama.get(s.id);
    if (!a) { perubahan.push({ jenis: "tambah", nama: s.nama, jumlah: s.jumlah, harga: s.harga, subtotal: s.subtotal }); continue; }
    if (a.nama !== s.nama || a.jumlah !== s.jumlah || a.harga !== s.harga) perubahan.push({ jenis: "ubah", no: a.no, nama: s.nama, jumlah: { sebelum: a.jumlah, sesudah: s.jumlah }, harga: { sebelum: a.harga, sesudah: s.harga }, subtotal: { sebelum: a.subtotal, sesudah: s.subtotal } });
  }
  for (const b of r.hapusBaris) perubahan.push({ jenis: "hapus", no: noBaris(b), nama: b.name, subtotal: snapBaris(b).subtotal });
  const berubah = !r.totalBaru.equals(r.totalLama);
  return {
    totalSebelum: moneyToNumber(r.totalLama), totalSesudah: moneyToNumber(r.totalBaru), selisih: moneyToNumber(r.totalBaru.minus(r.totalLama)),
    terbayar: moneyToNumber(r.terbayar), sisaSesudah: moneyToNumber(r.totalBaru.minus(r.terbayar)),
    jurnal: berubah ? "Jurnal penjualan dibalik lalu diposting ulang sebesar total baru (piutang karyawan ikut berubah)." : "Tidak ada perubahan jurnal (total sama).",
    jurnalBerubah: berubah, baris: perubahan,
  };
}

/** Pratinjau dampak (tidak menulis): dampak operasional (fungsi hitung yang sama dengan penerapan) + dampak Finance. Kesalahan dikembalikan sebagai { valid:false, galat }. */
export async function pratinjauKoreksiBaris(db, { penjualanId, operasi, expectedRevision = null }) {
  try {
    return await db.$transaction(async (tx) => {
      const { pkr, rows } = await muat(tx, penjualanId, { kunci: false });
      const r = await rencanakan(tx, { pkr, rows, operasi });
      const h = await hitungKoreksi(tx, { penjualanId, operasi: r.opsOperasional, expectedRevision, kunci: false, viaBaris: true, izinTanpaPerubahan: true });
      return { valid: true, revisi: h.revisiSekarang, nomor: pkr.nomor, order: { id: h.order.id, nomor: h.order.orderNumber }, dampak: { ...h.impact, keuangan: dampakKeuangan(r) } };
    });
  } catch (e) {
    if (e instanceof PkrOrderError || e instanceof ItemPkrError || e instanceof PenjualanItemError) {
      return { valid: false, galat: { pesan: e.message, kode: e.code ?? null, status: e.statusCode ?? 400, ...(e.extra ?? {}) } };
    }
    throw e;
  }
}

/** Terapkan koreksi baris penjualan. Dipanggil di DALAM transaksi pemanggil (atomik). */
export async function terapkanKoreksiBaris(tx, { penjualanId, operasi, expectedRevision, alasan, idempotencyKey, userId = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk koreksi item", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teksAlasan = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teksAlasan.length < 5) throw gagal("Alasan koreksi wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teksAlasan.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  const hashPermintaan = hash({ jenis: "baris", penjualanId, operasi, expectedRevision: Number(expectedRevision), alasan: teksAlasan });

  // 1. Kunci PKR, lalu cek replay SEBELUM menyentuh apa pun (penulisan Finance di bawah tidak boleh terulang).
  const { pkr, rows } = await muat(tx, penjualanId, { kunci: true });
  const ada = await tx.pkrItemRevision.findFirst({ where: { orderId: pkr.orderCrm.id, idempotencyKey: String(idempotencyKey) } });
  if (ada) {
    if (ada.impact?.hashPermintaan !== hashPermintaan) throw gagal("Idempotency-Key ini sudah dipakai untuk koreksi lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { replayed: true, revisi: ada.revision, nomor: pkr.nomor, orderId: pkr.orderCrm.id, dampak: ada.impact };
  }

  const r = await rencanakan(tx, { pkr, rows, operasi });
  if (r.opsOperasional.length === 0 && dampakKeuangan(r).baris.length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const totalBerubah = !r.totalBaru.equals(r.totalLama);
  const sebelumFinance = { total: moneyToNumber(r.totalLama), baris: pkr.items.map(snapBaris) };

  // 2. Baris Finance baru dulu (item operasional baru menautkan ke id-nya lewat FK).
  for (const nb of r.tambah?.baris ?? []) await tx.finPenjualanKaryawanItem.create({ data: dataBaris(pkr.id, nb) });

  // 3. Perubahan harga/jumlah baris yang ada (jumlah yang sama dengan item operasionalnya dijaga trigger DB tertunda saat COMMIT).
  for (const { baris, perubahan } of r.ubahBaris.values()) {
    const data = {};
    if (perubahan.harga !== undefined) data.unitPrice = r.hitung.items[r.barisSesudah.findIndex((s) => s.id === baris.id)].unitPrice;
    if (perubahan.jumlah !== undefined) data.quantity = r.hitung.items[r.barisSesudah.findIndex((s) => s.id === baris.id)].quantity;
    if (Object.keys(data).length) await tx.finPenjualanKaryawanItem.update({ where: { id: baris.id }, data });
  }

  // 4. Sisi Finance yang bergantung pada hasil operasional dijalankan DI DALAM terapkanKoreksi (setelah unit/item berubah, sebelum buku revisi ditulis).
  const sisiFinance = async (t) => {
    // Nama/ukuran/spesifikasi/kirim baris non-Set mengikuti item operasionalnya (satu sumber, sudah divalidasi hitungKoreksi); baris tanpa unit mengikuti masukan.
    for (const { baris, perubahan } of r.ubahBaris.values()) {
      if (punyaUnit(baris.fulfillment)) {
        const row = await t.pkrOrderItem.findFirst({ where: { saleItemId: baris.id, componentSeq: 1 } });
        if (row && row.bundleNo == null) {
          if (!row.productName) throw gagal(`Item ${noBaris(baris)}: nama item tidak boleh kosong`, 400, "NAMA_ITEM_WAJIB");
          await t.finPenjualanKaryawanItem.update({
            where: { id: baris.id },
            data: { name: row.productName, productId: row.productId ?? null, lengthCm: row.lengthCm, widthCm: row.widthCm, thicknessCm: row.thicknessCm, heightCm: row.heightCm, specNotes: row.specNotes, perluDikirim: row.perluDikirim },
          });
        } else if (row && perubahan.perluDikirim !== undefined) {
          await t.finPenjualanKaryawanItem.update({ where: { id: baris.id }, data: { perluDikirim: row.perluDikirim } });
        }
      } else {
        const data = {};
        if (perubahan.nama !== undefined) data.name = String(perubahan.nama).trim().slice(0, 160);
        if (perubahan.spesifikasi !== undefined) data.specNotes = String(perubahan.spesifikasi ?? "").trim() || null;
        if (Object.keys(data).length) await t.finPenjualanKaryawanItem.update({ where: { id: baris.id }, data });
      }
    }
    // Hapus baris (item operasionalnya sudah dihapus lunak di langkah operasional; penjaga DB menolak bila masih ada yang aktif).
    if (r.hapusBaris.length) await t.finPenjualanKaryawanItem.deleteMany({ where: { id: { in: r.hapusBaris.map((b) => b.id) } } });
    // Nomor urut baris baru mengikuti urutan penambahan; total + jurnal.
    if (totalBerubah) {
      await t.finPenjualanKaryawan.update({ where: { id: pkr.id }, data: { total: r.totalBaru } });
      await koreksiJurnalPenjualan(t, { penjualanId: pkr.id, userId, alasan: teksAlasan });
    }
    const sesudahBaris = await t.finPenjualanKaryawanItem.findMany({ where: { penjualanId: pkr.id }, orderBy: { sortOrder: "asc" } });
    return { before: sebelumFinance, after: { total: moneyToNumber(r.totalBaru), baris: sesudahBaris.map(snapBaris) } };
  };

  const hasil = await terapkanKoreksi(tx, {
    penjualanId, operasi: r.opsOperasional, expectedRevision, alasan: teksAlasan, idempotencyKey, userId,
    viaBaris: true, finance: sisiFinance, hashPermintaanLuar: hashPermintaan,
    // Ledger operasional hanya menyimpan fakta TANPA angka uang (angkanya ada di finance_before/finance_after).
    dampakTambahan: { berubah: totalBerubah, jurnalDiposting: totalBerubah, baris: r.barisSesudah.length },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pkr.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: { aksi: "koreksi_baris", nomor: pkr.nomor, alasan: teksAlasan, totalSebelum: String(r.totalLama), totalSesudah: String(r.totalBaru), revisi: hasil.revisi },
  });
  return { ...hasil, keuangan: dampakKeuangan(r) };
}
