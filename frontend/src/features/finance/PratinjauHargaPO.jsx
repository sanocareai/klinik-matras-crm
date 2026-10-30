import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, TriangleAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { api } from "@/api.js";
import { TombolAksi } from "@/features/finance/shared.jsx";
import { STATUS_HARGA_PO, bisaSetujuiHargaPO, ringkasHasilHargaPO, rpHarga } from "@/features/finance/hargaDariPOLogic.js";

// PRATINJAU HARGA LAMA → BARU sebelum PO disetujui. Persetujuan = PO disetujui + Harga Berlaku bahan diperbarui di SATU transaksi server (gagal ⇒ PO tetap draf).
// Ini HPP operasional (harga kerja): tidak menambah stok, tidak mengubah nilai persediaan Finance, tidak membuat jurnal, tidak menghitung ulang pemakaian lama.
export default function ModalSetujuiPO({ po, onClose, onDisetujui }) {
  const [pra, setPra] = useState(null);
  const [galat, setGalat] = useState("");
  const [lewati, setLewati] = useState(() => new Set());
  const muat = useCallback(async () => {
    setGalat("");
    try { setPra(await api.pratinjauHargaPO(po.id)); setLewati(new Set()); } catch (e) { setGalat(e.message || "Gagal memuat pratinjau harga"); }
  }, [po.id]);
  useEffect(() => { muat(); }, [muat]);

  const status = useMemo(() => (pra ? bisaSetujuiHargaPO(pra, lewati) : { bisa: false, alasan: "Memuat pratinjau…" }), [pra, lewati]);
  const alih = (id) => setLewati((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function setujui() {
    setGalat("");
    try {
      const hasil = await api.approvePurchaseOrder(po.id, { hashPratinjau: pra?.hash ?? null, lewatiBahan: [...lewati] });
      await onDisetujui(hasil, ringkasHasilHargaPO(hasil.hargaDariPO));
    } catch (e) {
      setGalat(e.message || "Persetujuan gagal — PO tetap draf dan tidak ada harga yang berubah.");
      if (e.code === "PRATINJAU_BERUBAH" || e.status === 409) muat().then(() => setGalat((g) => g || "Pratinjau dimuat ulang karena berubah."));
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Setujui ${po.poNumber}`}
      description="Periksa harga lama → baru. Harga setiap bahan menjadi Harga Berlaku operasional sejak PO disetujui."
      className="w-[920px]"
      footer={
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="galat-setujui-po" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] leading-snug text-red">{galat}</p>}
          {!status.bisa && pra && <p role="status" data-testid="alasan-tertahan" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-ink">{status.alasan}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4" data-testid="setujui-po-kembali">Kembali</Button>
            <TombolAksi disabled={!status.bisa} onClick={setujui} data-testid="setujui-po-konfirmasi"><CheckCircle2 size={14} /> Setujui PO{pra?.ringkas?.akanMengubahHarga ? ` & perbarui ${pra.ringkas.akanMengubahHarga} harga` : ""}</TombolAksi>
          </div>
        </div>
      }
    >
      {!pra ? <p className="py-6 text-[13px] text-ink3" data-testid="pratinjau-memuat">{galat ? "" : "Memuat pratinjau harga…"}</p> : (
        <div className="space-y-3" data-testid="pratinjau-harga-po">
          {pra.aktif === false && <p className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2">{pra.catatan}</p>}
          {pra.aktif !== false && (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] leading-relaxed text-ink2" data-testid="sumber-harga-po">
              <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>Sumber di riwayat harga: <b className="text-ink">{pra.sumberTeks}</b>. {pra.ringkas.akanMengubahHarga} bahan berubah · {pra.ringkas.sama} sama · {pra.ringkas.konflik} konflik.</span>
            </p>
          )}
          <ul className="m-0 list-none space-y-2 p-0">
            {pra.baris?.map((b) => {
              const st = STATUS_HARGA_PO[b.status] ?? { teks: b.status, varian: "neutral" };
              const konflik = ["KONFLIK_HARGA_BEDA", "KONVERSI_TIDAK_ADA", "KONVERSI_TIDAK_SAH"].includes(b.status);
              return (
                <li key={b.materialId} data-testid="baris-harga-po" data-status={b.status} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0"><div className="text-[13px] font-semibold text-ink">{b.nama}</div><div className="font-mono text-[11.5px] text-ink3">{b.kode} · satuan stok {b.satuanStok} · baris PO {b.barisPO.join(", ")}</div></div>
                    <Badge variant={st.varian}>{st.teks}</Badge>
                  </div>
                  {konflik ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="m-0 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-red" role="alert"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{b.alasan}</p>
                      <ul className="m-0 list-none p-0 text-[12px] text-ink2">{b.rincian.map((r) => <li key={r.barisPO}>Baris {r.barisPO}: {r.qty} {r.satuanBeli} × {rpHarga(r.hargaBeli)}{r.faktor ? ` (faktor ${r.faktor})` : ""}{r.hargaStok != null ? ` = ${rpHarga(r.hargaStok)} / ${b.satuanStok}` : ""}</li>)}</ul>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12.5px] text-ink sm:min-h-0">
                        <input type="checkbox" checked={lewati.has(b.materialId)} onChange={() => alih(b.materialId)} data-testid="lewati-bahan" className="size-4" />
                        Lewati pembaruan harga bahan ini (harga tidak diubah; ubah manual lewat Stok → Ubah harga)
                      </label>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-[1fr_auto_1fr_1fr]" data-testid="perbandingan-harga">
                        <div><div className="text-[11px] uppercase tracking-wide text-ink3">Harga Berlaku sekarang</div><div className="tabular-nums text-ink" data-testid="harga-lama">{b.hargaLama != null ? `${rpHarga(b.hargaLama)} / ${b.satuanStok}` : "Belum ada harga berlaku"}</div></div>
                        <ArrowRight size={16} className="hidden self-center text-ink3 sm:block" aria-hidden />
                        <div><div className="text-[11px] uppercase tracking-wide text-ink3">Harga baru dari PO</div><div className="font-semibold tabular-nums text-ink" data-testid="harga-baru">{rpHarga(b.hargaBaru)} / {b.satuanStok}{b.selisihPersen != null && b.status !== "SAMA" ? <span className={b.selisihPersen > 0 ? "ml-1.5 text-red" : "ml-1.5 text-green"}>{b.selisihPersen > 0 ? "+" : ""}{b.selisihPersen}%</span> : null}</div></div>
                        <div><div className="text-[11px] uppercase tracking-wide text-ink3">Harga di PO</div><div className="tabular-nums text-ink2">{rpHarga(b.hargaBeli)} / {b.satuanBeli}{b.faktor ? ` · 1 ${b.satuanBeli} = ${b.faktor} ${b.satuanStok}` : ""}</div></div>
                      </div>
                      {b.peringatan?.map((p) => <p key={p.kode} role="status" data-testid={`peringatan-${p.kode.toLowerCase().replace(/_/g, "-")}`} className="m-0 mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink"><TriangleAlert size={12} className="mt-0.5 shrink-0 text-orange" aria-hidden />{p.pesan}</p>)}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <details className="rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2">
            <summary className="cursor-pointer font-medium text-ink">Aturan pembaruan harga dari PO</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">{pra.aturan?.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </div>
      )}
    </Modal>
  );
}
