// KONFIRMASI MANIFEST posting historis (insiden 25 Okt 2026: batch yang berjalan BUKAN manifest yang dimaksud Owner).
//
// BATAS KONTROL (tertulis jujur): pencocokan yang diketik di dialog (hash, daftar order, jumlah) adalah KONFIRMASI MANIFEST oleh pelaksana — bukan bukti persetujuan Owner yang tercatat terpisah.
// Karena itu, SEMENTARA hanya akun ber-role OWNER yang boleh MEMULAI posting (batch/sinkron): Owner meninjau dan mengonfirmasi manifest sendiri. Finance/Admin hanya memantau; Finance boleh menghentikan/melanjutkan batch yang sudah ada.
// Yang dijamin server: eksekusi hanya untuk manifest yang PERSIS sama dengan yang dikonfirmasi — hash, ID unit, isi transaksi lengkap (order, bahan, kuantitas, satuan, tanggal), jumlah, saldo bahan saat ditinjau, dan rujukan.
// Selisih apa pun → ditolak (409) SEBELUM batch/movement dibuat dan dicatat (pelaku + peran + selisih). Persetujuan Owner terpisah (dua orang) belum ada; itu risiko sisa yang disebut di UI dan laporan.
import crypto from "node:crypto";
import { KoreksiError } from "./warehouseCorrection.js";
import { rolesOf } from "../middleware/authorize.js";

export const ENTITAS_KONFIRMASI = "posting_historis_konfirmasi";
export const MODE_KONTROL = "OWNER_MENINJAU_SENDIRI";
const HEX64 = /^[0-9a-f]{64}$/;
const urut = (a) => [...a].sort((x, y) => String(x).localeCompare(String(y)));
const himpunan = (arr) => new Set((arr ?? []).map((x) => String(x).trim()).filter(Boolean));
const sel = (a, b) => ({ lebih: [...a].filter((x) => !b.has(x)), kurang: [...b].filter((x) => !a.has(x)) }); // a = diberikan, b = rencana
const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
const kunciBaris = (l) => [l.unitId, l.orderNumber, l.kodeBahan, r4(l.qty), l.satuan, l.tanggal].join("|");
const teksBaris = (k) => { const [, o, b, q, s, t] = k.split("|"); return `${o} ${b} ${q} ${s} ${t}`; };

export const adalahOwner = (aktor) => rolesOf(aktor).includes("OWNER");

/** Baris isi transaksi kanonik (ID unit + order + bahan + kuantitas + satuan + tanggal), terurut. */
export function barisIsi(transaksi) {
  return transaksi.map((t) => ({ unitId: t.unitId, orderNumber: t.orderNumber, kodeBahan: t.kodeBahan, qty: r4(t.qty), satuan: t.satuan, tanggal: t.tanggal })).sort((a, b) => kunciBaris(a).localeCompare(kunciBaris(b)));
}
export const digestBaris = (baris) => crypto.createHash("sha256").update(JSON.stringify([...baris].map(kunciBaris).sort())).digest("hex");

/** Ringkasan kanonik sebuah rencana: dasar perbandingan dan isi rekaman. */
export function ringkasRencana(rencana) {
  const isiTransaksi = barisIsi(rencana.transaksi);
  const unitIds = urut(new Set(rencana.transaksi.map((t) => t.unitId)));
  const daftarOrder = urut(new Set(rencana.transaksi.map((t) => t.orderNumber)));
  return { hash: rencana.hash, unitIds, daftarOrder, jumlahOrder: daftarOrder.length, jumlahTrx: rencana.transaksi.length, isiTransaksi, digestIsi: digestBaris(isiTransaksi) };
}

/** Saldo ledger SEKARANG untuk tiap bahan di rencana: [{ kode, saldo }] terurut kode. */
export async function saldoBahanRencana(db, rencana) {
  const idPerKode = new Map(rencana.transaksi.map((t) => [t.materialId, t.kodeBahan]));
  const ids = [...idPerKode.keys()]; if (!ids.length) return [];
  const sum = await db.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: ids } }, _sum: { qty: true } });
  const saldo = new Map(sum.map((r) => [r.materialId, Number(r._sum.qty ?? 0)]));
  return ids.map((id) => ({ kode: idPerKode.get(id), saldo: r4(saldo.get(id) ?? 0) })).sort((a, b) => a.kode.localeCompare(b.kode));
}

function bentukTidakSah(k, rujukan) {
  const m = [];
  if (!k || typeof k !== "object") return ["konfirmasiManifest tidak ada"];
  if (!HEX64.test(String(k.hash ?? "").trim().toLowerCase())) m.push("hash yang dikonfirmasi harus 64 karakter hex (tempel utuh dari keputusan Owner)");
  if (!Array.isArray(k.unitIds) || !k.unitIds.length) m.push("daftar unit konfirmasi kosong");
  if (!Array.isArray(k.daftarOrder) || !k.daftarOrder.length) m.push("daftar order konfirmasi kosong");
  if (!Number.isInteger(k.jumlahOrder) || k.jumlahOrder < 1) m.push("jumlah order konfirmasi tidak valid");
  if (!Number.isInteger(k.jumlahTrx) || k.jumlahTrx < 1) m.push("jumlah transaksi konfirmasi tidak valid");
  if (String(k.rujukan ?? "").trim().length < 8) m.push("rujukan konfirmasi minimal 8 karakter");
  if (String(rujukan ?? "").trim() !== String(k.rujukan ?? "").trim()) m.push(`rujukan berbeda: konfirmasi "${String(k.rujukan ?? "").trim()}" ≠ permintaan "${String(rujukan ?? "").trim()}"`);
  if (!Array.isArray(k.isiTransaksi) || !k.isiTransaksi.length || k.isiTransaksi.some((l) => !l || !l.unitId || !l.orderNumber || !l.kodeBahan || !Number.isFinite(Number(l.qty)) || !l.satuan || !l.tanggal)) m.push("isi transaksi konfirmasi tidak lengkap (unit, order, bahan, kuantitas, satuan, tanggal)");
  if (!Array.isArray(k.saldoManifest) || !k.saldoManifest.length || k.saldoManifest.some((s) => !s?.kode || !Number.isFinite(Number(s.saldo)))) m.push("saldo bahan yang ditinjau tidak ada/tidak valid");
  if (k.saldoSyarat != null && (!Array.isArray(k.saldoSyarat) || k.saldoSyarat.some((s) => !s?.kode || !Number.isFinite(Number(s.saldo))))) m.push("syarat saldo tidak valid (kode bahan + angka)");
  return m;
}

/** Catat penolakan (tanpa efek stok). Gagal mencatat tidak boleh mengubah hasil penolakan. */
export async function catatPenolakan(db, aktor, jenis, data = {}) {
  try {
    await db.activityEvent.create({ data: { entityType: ENTITAS_KONFIRMASI, entityId: crypto.randomUUID(), eventType: "KONFIRMASI_DITOLAK", actorType: "USER", actorId: aktor?.id ?? null, metadata: { jenis, mode: MODE_KONTROL, aktorNama: aktor?.name ?? null, aktorRoles: rolesOf(aktor), ...data } } });
  } catch { /* audit best-effort */ }
}

/** Pagar peran SEMENTARA: hanya akun Owner yang memulai. Dipanggil pertama kali, sebelum menghitung apa pun. */
export async function wajibOwnerMemulai(db, aktor) {
  if (adalahOwner(aktor)) return;
  await catatPenolakan(db, aktor, "BUKAN_OWNER");
  throw new KoreksiError("Sementara hanya akun Owner yang dapat memulai posting historis: Owner meninjau dan mengonfirmasi manifest sendiri. Finance dan Admin dapat memantau; Finance dapat menghentikan atau melanjutkan batch yang sudah ada.", 403, "HANYA_OWNER_MEMULAI");
}
export async function wajibAdaKonfirmasi(db, aktor, persetujuan) {
  if (persetujuan?.konfirmasi) return;
  await catatPenolakan(db, aktor, "TANPA_KONFIRMASI");
  throw new KoreksiError("Eksekusi posting butuh konfirmasi manifest (hash, ID unit, isi transaksi, daftar order, jumlah, saldo, rujukan). Muat ulang halaman Posting Pemakaian Historis dan ulangi dari dialog konfirmasi.", 403, "KONFIRMASI_MANIFEST_WAJIB");
}

/**
 * Pagar server. Dipanggil SETELAH rencana dihitung dan SEBELUM batch/movement dibuat. Mengembalikan rekaman konfirmasi (disimpan di peristiwa BATCH_DIAJUKAN).
 * @param persetujuan { hashDisetujui, rujukan, disetujuiOleh, konfirmasi: { hash, unitIds, daftarOrder, jumlahOrder, jumlahTrx, rujukan, isiTransaksi, saldoManifest, digestIsi?, saldoSyarat? } }
 */
export async function wajibKonfirmasiManifest(db, { rencana, persetujuan, aktor }) {
  await wajibOwnerMemulai(db, aktor); await wajibAdaKonfirmasi(db, aktor, persetujuan);
  const k = persetujuan.konfirmasi; const rujukan = persetujuan.rujukan;
  const beda = bentukTidakSah(k, rujukan);
  const ringkas = ringkasRencana(rencana); const saldoKini = await saldoBahanRencana(db, rencana);
  if (!beda.length) {
    const hashK = String(k.hash).trim().toLowerCase();
    if (hashK !== ringkas.hash) beda.push(`hash manifest: dikonfirmasi ${hashK.slice(0, 12)}… ≠ rencana server ${ringkas.hash.slice(0, 12)}…`);
    if (String(persetujuan.hashDisetujui ?? "").trim().toLowerCase() !== ringkas.hash) beda.push("hash pada permintaan ≠ rencana server");
    const u = sel(himpunan(k.unitIds), new Set(ringkas.unitIds)); if (u.lebih.length || u.kurang.length) beda.push(`ID unit: ${u.lebih.length} di luar rencana, ${u.kurang.length} unit rencana tidak dikonfirmasi`);
    const o = sel(himpunan(k.daftarOrder), new Set(ringkas.daftarOrder));
    if (o.lebih.length) beda.push(`order dikonfirmasi yang tidak ada di rencana: ${o.lebih.slice(0, 8).join(", ")}`);
    if (o.kurang.length) beda.push(`order di rencana yang tidak dikonfirmasi: ${o.kurang.slice(0, 8).join(", ")}`);
    if (k.jumlahOrder !== ringkas.jumlahOrder) beda.push(`jumlah order: dikonfirmasi ${k.jumlahOrder} ≠ rencana ${ringkas.jumlahOrder}`);
    if (k.jumlahTrx !== ringkas.jumlahTrx) beda.push(`jumlah transaksi: dikonfirmasi ${k.jumlahTrx} ≠ rencana ${ringkas.jumlahTrx}`);
    const isiK = new Set(k.isiTransaksi.map((l) => kunciBaris(l))); const isiR = new Set(ringkas.isiTransaksi.map(kunciBaris)); const i = sel(isiK, isiR);
    if (i.lebih.length) beda.push(`isi transaksi dikonfirmasi yang tidak ada di rencana (${i.lebih.length}): ${i.lebih.slice(0, 3).map(teksBaris).join("; ")}`);
    if (i.kurang.length) beda.push(`isi transaksi rencana yang tidak dikonfirmasi (${i.kurang.length}): ${i.kurang.slice(0, 3).map(teksBaris).join("; ")}`);
    if (k.digestIsi != null && String(k.digestIsi).trim().toLowerCase() !== ringkas.digestIsi) beda.push("digest isi transaksi berbeda dari rencana");
    // saldo bahan yang DITINJAU harus sama dengan saldo ledger sekarang (saldo bergeser setelah ditinjau → tinjau ulang)
    const tinjau = new Map(k.saldoManifest.map((s) => [String(s.kode).trim(), r4(s.saldo)]));
    for (const s of saldoKini) {
      if (!tinjau.has(s.kode)) { beda.push(`saldo ${s.kode} tidak ikut ditinjau`); continue; }
      if (Math.abs(tinjau.get(s.kode) - s.saldo) > 1e-6) beda.push(`saldo ${s.kode} berubah sejak ditinjau: ${tinjau.get(s.kode)} → ${s.saldo}`);
    }
    if (Array.isArray(k.saldoSyarat) && k.saldoSyarat.length) {
      const bahan = await db.material.findMany({ where: { code: { in: k.saldoSyarat.map((s) => String(s.kode).trim()) } }, select: { id: true, code: true } });
      const sum = bahan.length ? await db.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: bahan.map((b) => b.id) } }, _sum: { qty: true } }) : [];
      const saldo = new Map(sum.map((r) => [r.materialId, Number(r._sum.qty ?? 0)])); const idPerKode = new Map(bahan.map((b) => [b.code, b.id]));
      for (const s of k.saldoSyarat) {
        const id = idPerKode.get(String(s.kode).trim());
        if (!id) { beda.push(`syarat saldo: bahan ${s.kode} tidak ditemukan`); continue; }
        const nyata = saldo.get(id) ?? 0; if (Math.abs(nyata - Number(s.saldo)) > 1e-6) beda.push(`syarat saldo ${s.kode}: ${Number(s.saldo)} ≠ sekarang ${r4(nyata)}`);
      }
    }
  }
  if (beda.length) {
    await catatPenolakan(db, aktor, "TIDAK_COCOK", { beda: beda.slice(0, 20), hashKonfirmasi: k?.hash ?? null, hashRencana: ringkas.hash, jumlahOrderKonfirmasi: k?.jumlahOrder ?? null, jumlahTrxKonfirmasi: k?.jumlahTrx ?? null, jumlahOrderRencana: ringkas.jumlahOrder, jumlahTrxRencana: ringkas.jumlahTrx, rujukan: k?.rujukan ?? null, unitDiminta: Array.isArray(k?.unitIds) ? k.unitIds.length : null });
    throw new KoreksiError("Konfirmasi manifest TIDAK COCOK dengan rencana posting — tidak ada batch atau pergerakan stok yang dibuat. Periksa pilihan order, lalu ulangi dengan konfirmasi yang benar.", 409, "KONFIRMASI_MANIFEST_TIDAK_COCOK", { penghalang: beda.slice(0, 20) });
  }
  return { mode: MODE_KONTROL, hash: ringkas.hash, unitIds: ringkas.unitIds, daftarOrder: ringkas.daftarOrder, jumlahOrder: ringkas.jumlahOrder, jumlahTrx: ringkas.jumlahTrx, digestIsi: ringkas.digestIsi, isiTransaksi: ringkas.isiTransaksi, saldoManifest: saldoKini, rujukan: String(rujukan).trim(), saldoSyarat: Array.isArray(k.saldoSyarat) ? k.saldoSyarat.map((s) => ({ kode: String(s.kode).trim(), saldo: Number(s.saldo) })) : [], aktorRoles: rolesOf(aktor), dikonfirmasiPada: new Date().toISOString() };
}

/**
 * Percobaan ULANG untuk hash yang sudah punya batch (klik ganda/refresh/tab lain): konfirmasi harus SAMA dengan rekaman batch (hash, ID unit, isi transaksi, saldo yang ditinjau, rujukan).
 * Beda → ditolak dan dicatat (dampak berbeda dari batch yang sudah diajukan). Batch lama tanpa rekaman: tidak ada pembanding → dikembalikan apa adanya (nol tulisan).
 */
export async function periksaPercobaanUlang(db, { aktor, tersimpan, persetujuan }) {
  if (!tersimpan) return;
  const k = persetujuan.konfirmasi; const beda = bentukTidakSah(k, persetujuan.rujukan);
  if (!beda.length) {
    if (String(k.hash).trim().toLowerCase() !== tersimpan.hash) beda.push("hash konfirmasi berbeda dari batch yang sudah diajukan");
    const u = sel(himpunan(k.unitIds), new Set(tersimpan.unitIds)); if (u.lebih.length || u.kurang.length) beda.push("ID unit berbeda dari batch yang sudah diajukan");
    if (digestBaris(k.isiTransaksi) !== tersimpan.digestIsi) beda.push("isi transaksi berbeda dari batch yang sudah diajukan");
    if (String(k.rujukan).trim() !== tersimpan.rujukan) beda.push(`rujukan berbeda dari batch yang sudah diajukan (${tersimpan.rujukan})`);
    const t = new Map(tersimpan.saldoManifest.map((s) => [s.kode, r4(s.saldo)]));
    for (const s of k.saldoManifest) if (t.has(String(s.kode).trim()) && Math.abs(t.get(String(s.kode).trim()) - r4(s.saldo)) > 1e-6) beda.push(`saldo ${s.kode} yang ditinjau berbeda dari batch yang sudah diajukan`);
  }
  if (beda.length) {
    await catatPenolakan(db, aktor, "ULANG_DAMPAK_BERBEDA", { beda: beda.slice(0, 20), hashKonfirmasi: k?.hash ?? null, hashBatch: tersimpan.hash, rujukan: k?.rujukan ?? null });
    throw new KoreksiError("Percobaan ulang ditolak: konfirmasi berbeda dari batch yang sudah diajukan untuk hash ini. Tidak ada yang ditulis.", 409, "KONFIRMASI_MANIFEST_TIDAK_COCOK", { penghalang: beda.slice(0, 20) });
  }
}
