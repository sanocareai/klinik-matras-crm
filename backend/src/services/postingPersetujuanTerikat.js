// PERSETUJUAN TERIKAT posting historis (insiden 25 Okt 2026: batch yang berjalan BUKAN manifest yang disetujui Owner).
// Server tidak lagi memercayai "hash dari layar" sebagai persetujuan: eksekusi wajib membawa persetujuan yang diketik/ditempel dari keputusan Owner di LUAR layar pilihan —
// hash manifest, daftar unit, daftar order, jumlah order, jumlah transaksi, rujukan, dan (opsional) syarat saldo. Semuanya dibandingkan dengan rencana yang dihitung server saat itu.
// Ada selisih → ditolak (409 PERSETUJUAN_TIDAK_COCOK) SEBELUM batch/movement dibuat; penolakan dicatat sebagai peristiwa audit (tanpa efek stok).
import crypto from "node:crypto";
import { KoreksiError } from "./warehouseCorrection.js";

export const ENTITAS_PERSETUJUAN = "posting_historis_persetujuan";
const HEX64 = /^[0-9a-f]{64}$/;
const urut = (a) => [...a].sort((x, y) => String(x).localeCompare(String(y)));
const himpunan = (arr) => new Set((arr ?? []).map((x) => String(x).trim()).filter(Boolean));
const sel = (a, b) => ({ lebih: [...a].filter((x) => !b.has(x)), kurang: [...b].filter((x) => !a.has(x)) }); // a = diberikan, b = rencana

/** Ringkasan kanonik sebuah rencana: dasar perbandingan dan isi rekaman persetujuan. */
export function ringkasRencana(rencana) {
  const unitIds = urut(new Set(rencana.transaksi.map((t) => t.unitId)));
  const daftarOrder = urut(new Set(rencana.transaksi.map((t) => t.orderNumber)));
  const isi = rencana.transaksi.map((t) => [t.orderNumber, t.kodeBahan, Number(t.qty), t.satuan, t.tanggal, t.kunci]).sort((a, b) => a.join("|").localeCompare(b.join("|")));
  return { hash: rencana.hash, unitIds, daftarOrder, jumlahOrder: daftarOrder.length, jumlahTrx: rencana.transaksi.length, digestIsi: crypto.createHash("sha256").update(JSON.stringify(isi)).digest("hex") };
}

function bentukTidakSah(terikat, rujukan) {
  const m = [];
  if (!terikat || typeof terikat !== "object") return ["persetujuanTerikat tidak ada"];
  if (!HEX64.test(String(terikat.hash ?? "").trim().toLowerCase())) m.push("hash persetujuan harus 64 karakter hex (tempel utuh dari keputusan Owner)");
  if (!Array.isArray(terikat.unitIds) || !terikat.unitIds.length) m.push("daftar unit persetujuan kosong");
  if (!Array.isArray(terikat.daftarOrder) || !terikat.daftarOrder.length) m.push("daftar order persetujuan kosong");
  if (!Number.isInteger(terikat.jumlahOrder) || terikat.jumlahOrder < 1) m.push("jumlah order persetujuan tidak valid");
  if (!Number.isInteger(terikat.jumlahTrx) || terikat.jumlahTrx < 1) m.push("jumlah transaksi persetujuan tidak valid");
  if (String(terikat.rujukan ?? "").trim().length < 8) m.push("rujukan persetujuan minimal 8 karakter");
  if (String(rujukan ?? "").trim() !== String(terikat.rujukan ?? "").trim()) m.push(`rujukan berbeda: persetujuan "${String(terikat.rujukan ?? "").trim()}" ≠ permintaan "${String(rujukan ?? "").trim()}"`);
  if (terikat.saldoSyarat != null && (!Array.isArray(terikat.saldoSyarat) || terikat.saldoSyarat.some((s) => !s?.kode || !Number.isFinite(Number(s.saldo))))) m.push("syarat saldo tidak valid (kode bahan + angka)");
  return m;
}

async function catatTolak(db, aktor, rencana, terikat, beda) {
  try {
    await db.activityEvent.create({ data: { entityType: ENTITAS_PERSETUJUAN, entityId: crypto.randomUUID(), eventType: "PERSETUJUAN_DITOLAK", actorType: "USER", actorId: aktor?.id ?? null, metadata: {
      beda: beda.slice(0, 20), hashPersetujuan: terikat?.hash ?? null, hashRencana: rencana?.hash ?? null, jumlahOrderPersetujuan: terikat?.jumlahOrder ?? null, jumlahTrxPersetujuan: terikat?.jumlahTrx ?? null,
      jumlahOrderRencana: rencana ? new Set(rencana.transaksi.map((t) => t.orderNumber)).size : null, jumlahTrxRencana: rencana?.transaksi.length ?? null, rujukan: terikat?.rujukan ?? null, unitDiminta: Array.isArray(terikat?.unitIds) ? terikat.unitIds.length : null,
    } } });
  } catch { /* pencatatan audit tidak boleh mengubah hasil penolakan */ }
}

/**
 * Pagar server. Dipanggil SETELAH rencana dihitung dan SEBELUM batch/movement dibuat. Mengembalikan rekaman persetujuan (disimpan di peristiwa BATCH_DIAJUKAN).
 * @param persetujuan { hashDisetujui, rujukan, disetujuiOleh, terikat: { hash, unitIds, daftarOrder, jumlahOrder, jumlahTrx, rujukan, digestIsi?, saldoSyarat?: [{kode, saldo}] } }
 */
export async function wajibPersetujuanTerikat(db, { rencana, persetujuan, aktor }) {
  const terikat = persetujuan?.terikat;
  if (!terikat) throw new KoreksiError("Eksekusi posting butuh persetujuan terikat (hash, daftar unit & order, jumlah order & transaksi, rujukan). Muat ulang halaman Posting Pemakaian Historis dan ulangi dari dialog konfirmasi.", 403, "PERSETUJUAN_TERIKAT_WAJIB");
  const rujukan = persetujuan.rujukan;
  const beda = bentukTidakSah(terikat, rujukan);
  const ringkas = ringkasRencana(rencana);
  if (!beda.length) {
    const hashTik = String(terikat.hash).trim().toLowerCase();
    if (hashTik !== ringkas.hash) beda.push(`hash manifest: disetujui ${hashTik.slice(0, 12)}… ≠ rencana server ${ringkas.hash.slice(0, 12)}…`);
    if (String(persetujuan.hashDisetujui ?? "").trim().toLowerCase() !== ringkas.hash) beda.push("hash pada permintaan ≠ rencana server");
    const u = sel(himpunan(terikat.unitIds), new Set(ringkas.unitIds)); if (u.lebih.length || u.kurang.length) beda.push(`daftar unit: ${u.lebih.length} unit di luar rencana, ${u.kurang.length} unit rencana tidak disetujui`);
    const o = sel(himpunan(terikat.daftarOrder), new Set(ringkas.daftarOrder));
    if (o.lebih.length) beda.push(`order disetujui yang tidak ada di rencana: ${o.lebih.slice(0, 8).join(", ")}`);
    if (o.kurang.length) beda.push(`order di rencana yang tidak disetujui: ${o.kurang.slice(0, 8).join(", ")}`);
    if (terikat.jumlahOrder !== ringkas.jumlahOrder) beda.push(`jumlah order: disetujui ${terikat.jumlahOrder} ≠ rencana ${ringkas.jumlahOrder}`);
    if (terikat.jumlahTrx !== ringkas.jumlahTrx) beda.push(`jumlah transaksi: disetujui ${terikat.jumlahTrx} ≠ rencana ${ringkas.jumlahTrx}`);
    if (terikat.digestIsi != null && String(terikat.digestIsi).trim().toLowerCase() !== ringkas.digestIsi) beda.push("isi transaksi (digest) berbeda dari rencana");
    if (Array.isArray(terikat.saldoSyarat) && terikat.saldoSyarat.length) {
      const kode = terikat.saldoSyarat.map((s) => String(s.kode).trim());
      const bahan = await db.material.findMany({ where: { code: { in: kode } }, select: { id: true, code: true } });
      const sum = bahan.length ? await db.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: bahan.map((b) => b.id) } }, _sum: { qty: true } }) : [];
      const saldo = new Map(sum.map((r) => [r.materialId, Number(r._sum.qty ?? 0)])); const idPerKode = new Map(bahan.map((b) => [b.code, b.id]));
      for (const s of terikat.saldoSyarat) {
        const id = idPerKode.get(String(s.kode).trim());
        if (!id) { beda.push(`syarat saldo: bahan ${s.kode} tidak ditemukan`); continue; }
        const nyata = saldo.get(id) ?? 0; if (Math.abs(nyata - Number(s.saldo)) > 1e-6) beda.push(`saldo ${s.kode}: syarat ${Number(s.saldo)} ≠ sekarang ${Math.round(nyata * 1e4) / 1e4}`);
      }
    }
  }
  if (beda.length) {
    await catatTolak(db, aktor, rencana, terikat, beda);
    throw new KoreksiError("Persetujuan TIDAK COCOK dengan rencana posting — tidak ada batch atau pergerakan stok yang dibuat. Periksa pilihan order, lalu ulangi dengan persetujuan yang benar.", 409, "PERSETUJUAN_TIDAK_COCOK", { penghalang: beda.slice(0, 20) });
  }
  return { hash: ringkas.hash, unitIds: ringkas.unitIds, daftarOrder: ringkas.daftarOrder, jumlahOrder: ringkas.jumlahOrder, jumlahTrx: ringkas.jumlahTrx, digestIsi: ringkas.digestIsi, rujukan: String(rujukan).trim(), saldoSyarat: Array.isArray(terikat.saldoSyarat) ? terikat.saldoSyarat.map((s) => ({ kode: String(s.kode).trim(), saldo: Number(s.saldo) })) : [] };
}
