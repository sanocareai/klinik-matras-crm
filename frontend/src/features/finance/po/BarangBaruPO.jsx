import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { TombolAksi, Pilihan } from "@/features/finance/shared.jsx";
import {
  SATUAN_OPSI, JENIS_SKU_OPSI, PESAN_NON_STOK, labelSatuan, materialBaru0, galatMaterialBaru, bodyMaterialBaru, jenisMasalah, teksPerbedaan,
} from "@/features/finance/purchaseOrderLogic.js";

// "Buat Barang Baru" dari PO + panel masalah barang mirip pada baris. Dipindah apa adanya dari FinancePurchaseOrders.jsx (tanpa perubahan perilaku) agar editor PO baru bisa memakainya tanpa impor melingkar.

// Modal "Buat Barang Baru". Tidak menulis apa pun: hanya mengumpulkan data + memeriksa duplikat. SKU baru lahir saat draf PO disimpan (satu transaksi dengan PO-nya).
export function ModalBarangBaru({ awal, supplierId, supplierNama, barisLain = [], autoPeriksa = false, onClose, onSimpan, onPakaiMaterial, onBatalkanBaru }) {
  const [m, setM] = useState(() => ({ ...materialBaru0(), ...(awal || {}) }));
  const [periksa, setPeriksa] = useState(null); // { pasti, mirip, berbeda }
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const set = (k, v) => { setM((s) => ({ ...s, [k]: v })); setPeriksa(null); };
  const beli = m.satuanBeli || m.satuanStok;
  const beda = !!m.satuanStok && beli !== m.satuanStok;
  const galatIsi = galatMaterialBaru(m);
  const perluKonfirmasi = !!periksa && periksa.pasti.length === 0 && periksa.mirip.length > 0;
  const alasanKurang = perluKonfirmasi && (!m.konfirmasiMirip || String(m.alasanMirip || "").trim().length < 5);

  async function periksaDanPakai(opsi) {
    const otomatis = opsi?.otomatis === true; // pemeriksaan otomatis saat modal dibuka dari tanda masalah di baris: hanya menampilkan hasil, tidak pernah menyimpan
    setGalat("");
    if (periksa && periksa.pasti.length === 0 && (periksa.mirip.length === 0 || (m.konfirmasiMirip && !alasanKurang))) return onSimpan(m);
    setSibuk(true);
    try {
      const r = await api.cekDuplikatSku({ supplierId, materialBaru: bodyMaterialBaru({ ...m, konfirmasiMirip: false }), barisLain });
      setPeriksa({ pasti: r.pasti || [], mirip: r.mirip || [], berbeda: r.berbeda || [] });
      if (!otomatis && (r.pasti || []).length === 0 && (r.mirip || []).length === 0 && (r.berbeda || []).length === 0) onSimpan(m);
    } catch (e) { setGalat(e.message || "Gagal memeriksa duplikat"); } finally { setSibuk(false); }
  }

  const adaBerbeda = (periksa?.berbeda?.length ?? 0) > 0;
  const label = periksa?.pasti.length ? "Barang sudah ada" : perluKonfirmasi ? "Lanjutkan sebagai barang baru" : periksa && adaBerbeda ? "Lanjutkan — ini varian baru" : "Periksa & pakai di PO";
  useEffect(() => { if (autoPeriksa) periksaDanPakai({ otomatis: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Buat Barang Baru"
      description={`Barang ini baru dibuat saat PO disimpan${supplierNama ? ` (supplier ${supplierNama})` : ""}. Belum ada stok, jurnal, atau utang yang tercatat.`}
      className="w-[640px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatIsi && m.nama)) && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatIsi}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <TombolAksi disabled={!!galatIsi || sibuk || !!periksa?.pasti.length || alasanKurang} onClick={periksaDanPakai}>{sibuk ? "Memeriksa…" : label}</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3" data-testid="modal-barang-baru">
        <Field label="Nama barang" required><Input value={m.nama} onChange={(e) => set("nama", e.target.value)} placeholder="mis. Lem Semprot 500 ml" maxLength={200} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kategori" required hint="mis. Perekat, Busa, Kain, APD."><Input value={m.kategori} onChange={(e) => set("kategori", e.target.value)} maxLength={80} /></Field>
          <Field label="Jenis" required>
            <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Jenis barang">
              {JENIS_SKU_OPSI.map((j) => (
                <button
                  key={j.key} type="button" role="radio" aria-checked={m.jenis === j.key} onClick={() => set("jenis", j.key)}
                  className={cn("rounded-lg border px-3 py-2 text-left max-sm:min-h-11", m.jenis === j.key ? "border-accent bg-hovertint" : "border-line")}
                >
                  <span className="block text-[12.5px] font-semibold text-ink">{j.label}</span>
                  <span className="block text-[11px] leading-snug text-ink3">{j.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        </div>
        <p className="rounded-lg bg-surface px-3 py-2 text-[11.5px] leading-snug text-ink2">{PESAN_NON_STOK}</p>
        <Field label="Spesifikasi singkat"><Input value={m.spesifikasi} onChange={(e) => set("spesifikasi", e.target.value)} placeholder="mis. kaleng aerosol 500 ml" maxLength={500} /></Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Satuan pembelian" hint="Satuan yang tertulis di PO dan faktur supplier.">
            <Pilihan value={beli} onChange={(v) => set("satuanBeli", v)} aria-label="Satuan pembelian">
              <option value="">— pilih —</option>
              {SATUAN_OPSI.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Pilihan>
          </Field>
          <Field label="Satuan stok" required hint="Satuan di Gudang. Setelah ada pergerakan stok, satuan ini terkunci.">
            <Pilihan value={m.satuanStok} onChange={(v) => set("satuanStok", v)} aria-label="Satuan stok">
              <option value="">— pilih —</option>
              {SATUAN_OPSI.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Pilihan>
          </Field>
        </div>
        {beda && (
          <Field label={`Faktor konversi: 1 ${labelSatuan(beli)} = … ${labelSatuan(m.satuanStok)}`} required hint="Maksimal 4 angka di belakang koma. Contoh: 1 box berisi 12 kaleng → isi 12.">
            <input
              type="number" inputMode="decimal" min="0" step="any" value={m.faktorKonversi} aria-label="Faktor konversi"
              onChange={(e) => set("faktorKonversi", e.target.value)}
              className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11"
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nama barang versi supplier"><Input value={m.namaSupplier} onChange={(e) => set("namaSupplier", e.target.value)} maxLength={200} /></Field>
          <Field label="Kode barang supplier"><Input value={m.kodeSupplier} onChange={(e) => set("kodeSupplier", e.target.value)} maxLength={100} /></Field>
          <Field label="MOQ (opsional)" hint="Jumlah pesan minimum dalam satuan pembelian."><Input type="number" inputMode="decimal" min="0" value={m.moq} onChange={(e) => set("moq", e.target.value)} /></Field>
          <Field label="Estimasi waktu kirim (hari, opsional)"><Input type="number" inputMode="numeric" min="0" max="365" value={m.estimasiKirimHari} onChange={(e) => set("estimasiKirimHari", e.target.value)} /></Field>
          <Field label="Lokasi penyimpanan (opsional)"><Input value={m.lokasi} onChange={(e) => set("lokasi", e.target.value)} placeholder="mis. Rak B2" maxLength={200} /></Field>
          <Field label="Catatan"><Input value={m.catatan} onChange={(e) => set("catatan", e.target.value)} maxLength={500} /></Field>
        </div>

        {periksa?.pasti.length > 0 && (
          <div role="alert" data-testid="duplikat-pasti" className="rounded-lg bg-redbg px-3 py-2.5 text-[12.5px] text-red">
            <p className="font-semibold">Barang ini sudah ada — pakai yang sudah ada, jangan buat SKU baru.</p>
            <ul className="mt-1.5 list-none space-y-1.5 p-0">
              {periksa.pasti.map((c) => (
                <li key={c.materialId || `baris-${c.dariBarisPO}`} className="flex flex-wrap items-center gap-2" data-testid="kandidat-pasti">
                  <span className="font-mono font-semibold">{c.kode}</span><span className="min-w-0 flex-1">{c.nama} · {labelSatuan(c.satuan)} <span className="opacity-80">({c.alasan})</span></span>
                  {c.materialId
                    ? <button type="button" onClick={() => onPakaiMaterial(c.materialId)} data-testid="pakai-material" className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-white max-sm:min-h-11">Pakai material ini</button>
                    : <button type="button" onClick={() => onBatalkanBaru?.()} data-testid="batalkan-baru" className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent max-sm:min-h-11">Batalkan barang baru ini</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {perluKonfirmasi && (
          <div role="alert" data-testid="duplikat-mirip" className="rounded-lg bg-orangebg px-3 py-2.5 text-[12.5px] text-orange">
            <p className="font-semibold">Perlu keputusan Anda — belum bisa dipastikan sama atau berbeda.</p>
            <ul className="mt-1.5 list-none space-y-1.5 p-0">
              {periksa.mirip.map((c) => (
                <li key={c.materialId || `baris-${c.dariBarisPO}`} className="flex flex-wrap items-center gap-2" data-testid="kandidat-mirip">
                  <span className="font-mono font-semibold">{c.kode}</span>
                  <span className="min-w-0 flex-1">{c.nama} · {labelSatuan(c.satuan)}<span className="block text-[11.5px] opacity-90">{(c.belumJelas?.length ? c.belumJelas : [c.alasan]).join("; ")}</span></span>
                  {c.materialId && <button type="button" onClick={() => onPakaiMaterial(c.materialId)} data-testid="pakai-material" className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent max-sm:min-h-11">Pakai material ini</button>}
                </li>
              ))}
            </ul>
            <label className="mt-2 flex items-start gap-2 text-ink">
              <input type="checkbox" checked={!!m.konfirmasiMirip} onChange={(e) => setM((s) => ({ ...s, konfirmasiMirip: e.target.checked }))} className="mt-0.5 max-sm:h-5 max-sm:w-5" />
              <span>Saya sudah memeriksa — ini memang barang yang berbeda.</span>
            </label>
            {m.konfirmasiMirip && <div className="mt-1.5"><Input value={m.alasanMirip} onChange={(e) => setM((s) => ({ ...s, alasanMirip: e.target.value }))} placeholder="Alasan (wajib, min. 5 huruf), mis. ukuran lain" aria-label="Alasan melanjutkan barang mirip" maxLength={300} /></div>}
          </div>
        )}
        {adaBerbeda && (
          <details data-testid="varian-serupa" open={periksa.pasti.length === 0 && periksa.mirip.length === 0} className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink2">
            <summary className="cursor-pointer font-semibold text-ink max-sm:flex max-sm:min-h-11 max-sm:items-center">Varian serupa yang sudah ada ({periksa.berbeda.length}) — berbeda jelas, tidak perlu konfirmasi atau alasan</summary>
            <ul className="mt-1.5 list-none space-y-2 p-0">
              {periksa.berbeda.map((c) => (
                <li key={c.materialId || `baris-${c.dariBarisPO}`} data-testid="kandidat-berbeda">
                  <div className="flex flex-wrap items-baseline gap-2"><span className="font-mono font-semibold text-ink">{c.kode}</span><span className="min-w-0 flex-1">{c.nama} · {labelSatuan(c.satuan)}</span></div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">{(c.perbedaan || []).map((p) => <mark key={p.kunci} className="rounded-md bg-orangebg px-1.5 py-0.5 text-[11.5px] font-medium text-orange" data-testid="perbedaan">{teksPerbedaan(p)}</mark>)}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  );
}

// Masalah barang mirip PADA BARIS: apa yang terjadi + tombol penyelesaian (pakai material yang ada / hapus baris / periksa & konfirmasi). Tidak pernah mengganti pilihan pengguna otomatis.
export function PanelMasalahBaris({ m, onPakai, onPeriksa, onHapus }) {
  const jenis = jenisMasalah(m); const kandidat = jenis === "KONFIRMASI" ? m.mirip : m.pasti;
  const judul = jenis === "PASTI_KATALOG" ? "Barang ini sudah ada di katalog — pakai yang sudah ada." : jenis === "PASTI_PO" ? `Sama dengan baris ${m.barisSama ?? kandidat.find((c) => c.dariBarisPO)?.dariBarisPO ?? "lain"} di PO ini — hapus salah satu atau gabungkan jumlahnya.` : "Perlu keputusan Anda — mirip, belum bisa dipastikan sama atau berbeda.";
  return (
    <div role="alert" data-testid="masalah-baris" data-jenis={jenis} className={cn("mt-2 rounded-lg px-3 py-2.5 text-[12.5px]", jenis === "KONFIRMASI" ? "bg-orangebg text-orange" : "bg-redbg text-red")}>
      <p className="m-0 font-semibold">{judul}</p>
      <ul className="mt-1 list-none space-y-1 p-0">
        {kandidat.slice(0, 4).map((c) => (
          <li key={c.materialId || `baris-${c.dariBarisPO}`} className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{c.kode}</span><span className="min-w-0 flex-1">{c.nama}{c.belumJelas?.length ? <span className="block text-[11.5px] opacity-90">{c.belumJelas.join("; ")}</span> : null}</span>
            {c.materialId && <button type="button" onClick={() => onPakai(c.materialId)} data-testid="masalah-pakai" className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent max-sm:min-h-11">Pakai {c.kode}</button>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        {jenis === "KONFIRMASI" && <button type="button" onClick={onPeriksa} data-testid="masalah-periksa" className="rounded-lg bg-surface px-3 py-1.5 text-[12px] font-semibold text-accent max-sm:min-h-11">Periksa &amp; konfirmasi barang baru</button>}
        {jenis !== "KONFIRMASI" && <button type="button" onClick={onPeriksa} data-testid="masalah-ubah" className="rounded-lg bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink2 max-sm:min-h-11">Ubah barang baru</button>}
        {jenis === "PASTI_PO" && <button type="button" onClick={onHapus} data-testid="masalah-hapus" className="rounded-lg bg-surface px-3 py-1.5 text-[12px] font-semibold text-red max-sm:min-h-11">Hapus baris ini</button>}
      </div>
    </div>
  );
}
