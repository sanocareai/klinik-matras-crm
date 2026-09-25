import React from "react";
import { Field } from "@/components/ui/field.jsx";
import { Pilihan, formatUang } from "@/features/finance/shared.jsx";

// JENIS TAGIHAN SUPPLIER (B3.3). Menentukan ke mana nilai tagihan masuk buku besar saat DISETUJUI.
// Aturan & penjaga double-counting ditegakkan server (backend/src/services/finance/jenisTagihan.js); di sini hanya pilihan
// yang relevan per jenis supaya staf tidak memilih akun beban untuk bahan baku.

import { JENIS_TAGIHAN, opsiKategori, metodeUntukTanggal, tanggalIndonesia, CATATAN_PERIODIK } from "@/features/finance/jenisTagihanLogika.js";
export { JENIS_TAGIHAN, opsiKategori, bodyJenis, jenisLengkap } from "@/features/finance/jenisTagihanLogika.js";

/**
 * @param f        { billType, goodsReceiptId, expenseCategoryId, purchaseCategoryId, amount, supplierId }
 * @param set      (kunci, nilai) => void
 * @param unbilled penerimaan barang yang belum ditagih (GET /finance/bills/unbilled-receipts)
 * @param grTertaut penerimaan yang sudah tertaut ke tagihan ini (mode edit)
 */
export default function PilihJenisTagihan({ f, set, kategori, kategoriBeli, unbilled = [], grTertaut = null, namaSupplier = "", metodeInfo = null }) {
  const jenis = JENIS_TAGIHAN.find((j) => j.kode === f.billType);
  const opsi = opsiKategori(f.billType, { kategori, kategoriBeli });
  const daftarGr = grTertaut && !unbilled.some((r) => r.id === grTertaut.id) ? [grTertaut, ...unbilled] : unbilled;
  const gr = daftarGr.find((r) => r.id === f.goodsReceiptId);
  const selisih = gr && Number(f.amount) > 0 ? Number(f.amount) - Number(gr.nilaiTerima || 0) : null;
  const pakaiAset = ["MESIN_PERALATAN", "UANG_MUKA_PEMBELIAN"].includes(f.billType);
  const metode = metodeUntukTanggal(metodeInfo, f.billDate);

  return (
    <div className="space-y-3" data-testid="jenis-tagihan">
      <Field label="Jenis tagihan" required hint={jenis?.ket || "Menentukan akun buku besar saat tagihan disetujui"}>
        <Pilihan value={f.billType || ""} onChange={(v) => { set("billType", v); set("expenseCategoryId", ""); set("purchaseCategoryId", ""); if (v !== "BAHAN_BAKU") set("goodsReceiptId", ""); }}>
          <option value="">— pilih jenis tagihan —</option>
          {JENIS_TAGIHAN.map((j) => <option key={j.kode} value={j.kode}>{j.label}</option>)}
        </Pilihan>
      </Field>

      {f.billType === "BAHAN_BAKU" && (
        <>
          <Field label="Penerimaan barang (Gudang)" hint="Tautkan bila barangnya sudah dicatat di Gudang — nilainya sudah masuk Persediaan saat diterima, jadi tagihan hanya menutupnya.">
            <Pilihan value={f.goodsReceiptId || ""} onChange={(v) => set("goodsReceiptId", v)}>
              <option value="">— tanpa penerimaan gudang —</option>
              {daftarGr.map((r) => (
                <option key={r.id} value={r.id}>{r.receiptNumber} · {r.supplier || "tanpa supplier"} · diterima {formatUang(r.nilaiTerima)}</option>
              ))}
            </Pilihan>
          </Field>
          {gr ? (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-inset px-3 py-2 text-[12.5px] sm:grid-cols-2">
              <div><dt className="text-ink3">Supplier (penerimaan)</dt><dd className="text-ink">{gr.supplier || "—"}{namaSupplier && gr.supplier && gr.supplier.toLowerCase() !== namaSupplier.toLowerCase() ? <span className="text-orange"> · beda nama dengan supplier tagihan</span> : null}</dd></div>
              <div><dt className="text-ink3">Dokumen</dt><dd className="text-ink">{gr.receiptNumber}</dd></div>
              <div><dt className="text-ink3">Nilai diterima</dt><dd className="text-ink">{formatUang(gr.nilaiTerima)}</dd></div>
              <div><dt className="text-ink3">Nilai ditagih</dt><dd className="text-ink">{Number(f.amount) > 0 ? formatUang(Number(f.amount)) : "—"}</dd></div>
              {selisih !== null && (
                <div className="sm:col-span-2"><dt className="text-ink3">Selisih (masuk Selisih Harga Pembelian)</dt>
                  <dd className={Math.abs(selisih) < 0.005 ? "text-green" : "text-orange"}>{Math.abs(selisih) < 0.005 ? "Rp0 — cocok" : formatUang(selisih)}</dd></div>
              )}
              {gr.barisTanpaHarga > 0 && <div className="sm:col-span-2 text-orange">{gr.barisTanpaHarga} baris penerimaan belum punya harga — lengkapi di Gudang dulu, tagihan belum bisa disetujui.</div>}
            </dl>
          ) : (
            metode === "PERPETUAL" ? (
              <p className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="catatan-perpetual">
                Mulai {tanggalIndonesia(metodeInfo?.cutover)} persediaan memakai <strong>metode perpetual</strong>: bahan baku wajib menaut Penerimaan Barang Gudang
                (Gudang › Penerimaan Barang). Tagihan bahan baku tanpa penerimaan tidak bisa disimpan atau disetujui.
              </p>
            ) : (
              <div className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] text-ink2" data-testid="catatan-periodik">
                <p><strong>{CATATAN_PERIODIK}</strong></p>
                <p className="mt-1">
                  Tanpa penerimaan gudang: saat disetujui dicatat <strong>Dr Beban Pokok Bahan Baku (5-1100) / Cr Utang Usaha</strong>.
                  Kalau barangnya juga akan dicatat di Gudang › Penerimaan Barang, tautkan penerimaannya — server menolak persetujuan bila berisiko tercatat dua kali.
                </p>
              </div>
            )
          )}
        </>
      )}

      {f.billType && f.billType !== "BAHAN_BAKU" && (
        <Field label={pakaiAset ? "Jenis aset" : "Kategori biaya"} required>
          <Pilihan
            value={(pakaiAset ? f.purchaseCategoryId : f.expenseCategoryId) || ""}
            onChange={(v) => set(pakaiAset ? "purchaseCategoryId" : "expenseCategoryId", v)}
          >
            <option value="">— pilih —</option>
            {opsi.map((k) => <option key={k.id} value={k.id}>{k.name} → {k.account?.code}</option>)}
          </Pilihan>
        </Field>
      )}
    </div>
  );
}
