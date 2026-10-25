import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { TEKS, rp, rpNilai, tanggalJam, KELOMPOK_PENERAPAN_TEKS, GAP_TEKS } from "./hargaBerlakuLogic.js";

// TINDAKAN KHUSUS: memberi/menyelaraskan harga berlaku pada pemakaian LAMA (sudah diposting). Tidak otomatis, tidak menyentuh stok/ISSUE/jurnal/GL/valuasi Finance.
// Pengaju memilih kelompok (dan baris) + alasan → pratinjau dari server → ajukan; orang LAIN yang menyetujui (hash pratinjau sama).
const SEMUA = ["BELUM_DIBEKUKAN", "TANPA_HARGA_BERLAKU", "SELARAS_ULANG"];

export default function PenerapanLamaModal({ open, onClose, bahan, bolehUbah, bolehSetujui, onSelesai }) {
  const [grup, setGrup] = useState(["BELUM_DIBEKUKAN", "TANPA_HARGA_BERLAKU"]); const [pra, setPra] = useState(null); const [terpilih, setTerpilih] = useState(new Set());
  const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const [antre, setAntre] = useState([]);
  const kunci = useRef(`penerapan-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`);

  const muatAntre = useCallback(() => api.daftarPenerapanHarga(bahan.id, "DIAJUKAN").then((r) => setAntre(r.penerapan ?? [])).catch(() => setAntre([])), [bahan.id]);
  useEffect(() => { if (open) muatAntre(); }, [open, muatAntre]);
  const tukarGrup = (k) => { setGrup((g) => (g.includes(k) ? g.filter((x) => x !== k) : [...g, k])); setPra(null); };

  const lihat = async () => {
    setSibuk(true); setGalat("");
    try { const r = await api.pratinjauPenerapanHarga({ materialId: bahan.id, groups: grup }); setPra(r); setTerpilih(new Set(r.penerapan.baris.map((x) => x.movementId))); }
    catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  };
  // hash dihitung server untuk SELURUH hasil; bila pengaju melepas centang sebagian baris, pratinjau diminta ulang dengan daftar movementIds eksplisit
  const ajukan = async () => {
    if (sibuk) return; setSibuk(true); setGalat("");
    try {
      const semua = pra.penerapan.baris.map((x) => x.movementId); const subset = semua.length === terpilih.size ? null : [...terpilih];
      const dasar = { materialId: bahan.id, groups: grup, ...(subset ? { movementIds: subset } : {}) };
      const p = subset ? await api.pratinjauPenerapanHarga(dasar) : pra;
      await api.ajukanPenerapanHarga({ ...dasar, hashPratinjau: p.hash, alasan: alasan.trim() }, kunci.current);
      setPra(null); setAlasan(""); await muatAntre(); onSelesai?.();
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  };
  const aksi = async (fn) => { setSibuk(true); setGalat(""); try { await fn(); await muatAntre(); onSelesai?.(); } catch (e) { setGalat(e.message); } finally { setSibuk(false); } };

  return (
    <Modal portalToBody open={open} onOpenChange={(o) => (o ? null : onClose())} title="Beri harga ke pemakaian lama" description={`${bahan.kode} — ${bahan.nama}`} className="sm:w-[640px]"
      footer={<Button variant="neutral" size="sm" onClick={onClose}>Tutup</Button>}>
      <div className="space-y-3" data-testid="modal-penerapan">
        <p className="rounded-btn bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2">{pra?.aturan ?? "Tindakan khusus berpersetujuan: tidak otomatis untuk semua order lama; tidak mengubah stok, ISSUE, jurnal, GL, atau valuasi Finance."} <b>{TEKS.bukan}</b></p>
        {galat && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="galat-penerapan">{galat}</p>}

        {antre.length > 0 && (
          <section className="space-y-2" data-testid="antre-penerapan">
            <h4 className="m-0 text-[12px] font-bold text-ink">Menunggu keputusan</h4>
            {antre.map((a) => (
              <div key={a.id} className="rounded-btn border border-line px-3 py-2 text-[12px] text-ink2">
                <div><b className="text-ink">{a.pratinjau.transaksi} pemakaian</b> · {rpNilai(a.pratinjau.nilai)} · diajukan {tanggalJam(a.diajukanPada)}{a.milikSaya ? " · oleh Anda" : ""}</div>
                <div className="text-ink3">Alasan: {a.alasan}</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {a.milikSaya && bolehUbah && <Button size="sm" variant="neutral" disabled={sibuk} onClick={() => aksi(() => api.batalkanPenerapanHarga(a.id))}>Batalkan pengajuan</Button>}
                  {!a.milikSaya && bolehSetujui && <>
                    <Button size="sm" disabled={sibuk} onClick={() => aksi(() => api.setujuiPenerapanHarga(a.id, { hashPratinjau: a.pratinjau.hash }))} data-testid="setujui-penerapan">Setujui</Button>
                    <Button size="sm" variant="neutral" disabled={sibuk} onClick={() => { const c = window.prompt("Alasan menolak (min 5 karakter)"); if (c) aksi(() => api.tolakPenerapanHarga(a.id, { catatan: c })); }}>Tolak</Button></>}
                  {a.milikSaya && <span className="text-[11.5px] text-ink3">Penyetuju harus orang lain.</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        {bolehUbah && antre.length === 0 && (
          <section className="space-y-2" data-testid="form-penerapan">
            <h4 className="m-0 text-[12px] font-bold text-ink">Ajukan penerapan baru</h4>
            <div className="space-y-1">
              {SEMUA.map((k) => (
                <label key={k} className="flex items-start gap-2 text-[12.5px] text-ink2"><input type="checkbox" checked={grup.includes(k)} onChange={() => tukarGrup(k)} className="mt-0.5" data-testid={`grup-${k}`} />
                  <span>{KELOMPOK_PENERAPAN_TEKS[k]}{pra ? <span className="ml-1 text-ink3">({pra.tersedia[k]} tersedia)</span> : null}</span></label>
              ))}
            </div>
            <Button size="sm" variant="secondary" onClick={lihat} disabled={sibuk || grup.length === 0} data-testid="lihat-penerapan">{sibuk && <Loader2 size={14} className="animate-spin" />}Lihat pratinjau</Button>

            {pra && (
              <div className="space-y-2" data-testid="pratinjau-penerapan">
                <div className="text-[12px] text-ink2"><b className="text-ink">{pra.penerapan.jumlah}</b> pemakaian dapat diberi harga ({rpNilai(pra.penerapan.nilai)}) · <b className="text-ink">{pra.gap.jumlah}</b> tanpa harga berlaku pada waktu pemakaian (tetap tanpa harga).</div>
                {pra.penerapan.baris.length > 0 && (
                  <div className="max-h-52 overflow-auto rounded-btn border border-line">
                    <table className="w-full text-[11.5px]"><thead className="sticky top-0 bg-inset text-left text-ink3"><tr><th className="px-2 py-1"> </th><th className="px-2 py-1">Order</th><th className="px-2 py-1">Tanggal</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-right">Harga berlaku</th><th className="px-2 py-1 text-right">HPP operasional</th></tr></thead>
                      <tbody>{pra.penerapan.baris.map((x) => (
                        <tr key={x.movementId} className="border-t border-line">
                          <td className="px-2 py-1"><input type="checkbox" checked={terpilih.has(x.movementId)} onChange={() => setTerpilih((s) => { const n = new Set(s); n.has(x.movementId) ? n.delete(x.movementId) : n.add(x.movementId); return n; })} aria-label={`Pilih ${x.order ?? x.unit}`} /></td>
                          <td className="px-2 py-1">{x.order ?? x.unit}</td><td className="px-2 py-1">{x.tanggal}</td><td className="px-2 py-1 text-right tabular-nums">{Math.abs(x.qty)} {x.satuan}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{rp(x.harga)}</td><td className="px-2 py-1 text-right tabular-nums">{x.nilaiSebelum != null ? <span className="mr-1 text-ink3 line-through">{rpNilai(x.nilaiSebelum)}</span> : null}{rpNilai(x.nilaiBaru)}</td></tr>))}</tbody></table>
                  </div>
                )}
                {pra.perOrder?.length > 0 && <div className="text-[11.5px] text-ink3" data-testid="dampak-per-order">Dampak per order: {pra.perOrder.slice(0, 6).map((o) => `${o.order}: ${rpNilai(o.hppOperasionalSebelum)} → ${rpNilai(o.hppOperasionalSesudah)}${o.sisaTanpaHargaOperasional ? ` (masih ${o.sisaTanpaHargaOperasional} tanpa harga)` : ""}`).join(" · ")}{pra.perOrder.length > 6 ? ` · +${pra.perOrder.length - 6} order` : ""}</div>}
                {pra.gap.jumlah > 0 && <div className="rounded-btn bg-orangebg px-3 py-2 text-[11.5px] text-ink2" data-testid="gap-penerapan">{pra.gap.catatan} {[...new Set(pra.gap.baris.map((g) => g.gap))].map((g) => GAP_TEKS[g] ?? g).join(" · ")}</div>}
                <label className="block text-[12px] font-medium text-ink2">Alasan (wajib)<textarea rows={2} value={alasan} onChange={(e) => setAlasan(e.target.value)} className="mt-1 w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="alasan-penerapan" /></label>
                <Button size="sm" onClick={ajukan} disabled={sibuk || terpilih.size === 0 || alasan.trim().length < 5} data-testid="ajukan-penerapan">{sibuk && <Loader2 size={14} className="animate-spin" />}Ajukan ({terpilih.size}) — perlu persetujuan orang lain</Button>
              </div>
            )}
          </section>
        )}
        {!bolehUbah && antre.length === 0 && <p className="text-[12px] text-ink3">Anda hanya dapat melihat. Pengajuan memerlukan izin Finance (posting).</p>}
      </div>
    </Modal>
  );
}
