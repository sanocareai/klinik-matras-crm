// Pembantu tes: penerimaan dari PO sekarang dinyatakan TIBA lewat pintu resmi "Catat Barang Tiba" (Barang Akan Datang), bukan dengan memajukan status / mengisi jumlah datang langsung.
// Tes lama yang menyiapkan penerimaan siap-putaway memakai pembantu ini supaya tetap menguji hal yang sama (stok, jurnal, faktur) lewat jalur yang benar.
import { randomUUID } from "node:crypto";

export const hariIniWIB = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Catat kedatangan resmi. `klien` = klien HTTP Gudang (inventory:write). Mengembalikan respons mentah. */
export function catatTibaResmi(klien, { poId, receiptId = null, lines, tanggal = hariIniWIB(), penerima = "Penerima Uji", catatan = "Barang tiba (uji)", suratJalan }) {
  return klien.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, {
    ...(receiptId && { receiptId }), tanggalTiba: tanggal, penerima, catatan, ...(suratJalan && { suratJalan }), lines,
  }, { "Idempotency-Key": `uji-tiba-${randomUUID()}` });
}

/**
 * Bawa penerimaan dari PO (hasil POST /goods-receipts, status DRAFT) sampai SIAP DISIMPAN: jadwalkan → catat tiba resmi → periksa → siap simpan.
 * `baik` undefined = hanya sampai tiba+periksa tanpa mengisi hasil (mis. untuk uji penolakan). Mengembalikan respons catat-tiba.
 */
export async function bawaSampaiSiap(klien, gr, { datang, baik, tolak = 0, lineIndex = 0, tanggal, sampaiInspeksi = false }) {
  const urut = (st) => klien.patch(`/api/inventory/goods-receipts/${gr.id}`, { status: st });
  let r = await urut("SCHEDULED"); if (r.status !== 200) throw new Error(`SCHEDULED gagal: ${JSON.stringify(r.body)}`);
  const baris = gr.lines[lineIndex];
  const t = await catatTibaResmi(klien, { poId: gr.purchaseOrderId, receiptId: gr.id, tanggal: tanggal ?? undefined, lines: [{ purchaseOrderLineId: baris.purchaseOrderLineId, jumlahDatang: datang }] });
  if (t.status !== 201) throw new Error(`catat tiba gagal: ${JSON.stringify(t.body)}`);
  r = await urut("INSPECTION"); if (r.status !== 200) throw new Error(`INSPECTION gagal: ${JSON.stringify(r.body)}`);
  if (baik !== undefined) {
    const p = await klien.patch(`/api/inventory/goods-receipts/${gr.id}/lines/${baris.id}`, { acceptedQty: baik, rejectedQty: tolak });
    if (p.status !== 200) throw new Error(`isi hasil periksa gagal: ${JSON.stringify(p.body)}`);
  }
  if (!sampaiInspeksi) { r = await urut("READY_FOR_PUTAWAY"); if (r.status !== 200) throw new Error(`READY gagal: ${JSON.stringify(r.body)}`); }
  return t;
}
