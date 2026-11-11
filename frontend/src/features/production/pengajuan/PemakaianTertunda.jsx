import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, Pencil, ShieldAlert } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { PENGAJUAN_BERUBAH, STATUS_TEKS, alasanTahan, kabarkanPengajuan, teksRingkas, waktuSingkat } from "@/features/production/pengajuan/pengajuanModel.js";

// PEMAKAIAN TERTUNDA — bahan yang SUDAH DILAPORKAN tetapi belum diverifikasi ADMIN (stok & HPP belum berubah). Tampil terpisah dari pemakaian resmi,
// supaya operator dan admin produksi tahu bahan sudah dilaporkan (tidak dicatat ulang).
// UBAH (Owner, Nov 2026): yang belum diverifikasi bisa langsung diubah tim produksi/QC; pemakaian bukti tahap yang SUDAH sah (denganTerverifikasi) bisa diubah juga —
// perubahan diajukan untuk verifikasi ulang ADMIN dan angka sah tetap berlaku sampai disahkan.
const INPUT = "h-10 min-w-0 rounded-btn border border-line bg-surface px-2.5 text-[13px] text-ink";

function FormUbah({ p, onSelesai, onBatal }) {
  const baris = p.ringkasan?.baris || [];
  const [qty, setQty] = useState(() => baris.map((b) => String(b.qty ?? "")));
  const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState("");
  const unit = p.jalur === "UNIT_BAHAN";
  const sah = qty.every((q) => q.trim() !== "" && Number.isFinite(Number(q.replace(",", "."))) && Number(q.replace(",", ".")) >= 0) && alasan.trim().length >= 5;
  async function kirim() {
    setSibuk(true); setGalat("");
    try {
      const angka = qty.map((q) => Number(q.replace(",", ".")));
      const body = unit ? { qty: angka[0], alasan: alasan.trim() } : { baris: baris.map((b, i) => ({ materialId: b.materialId, qty: angka[i] })).filter((b) => b.qty > 0), alasan: alasan.trim() };
      const r = await api.ubahPengajuanPemakaian(p.id, body); kabarkanPengajuan(); onSelesai(r.pesan);
    } catch (e) { setGalat(e.message || "Gagal mengubah"); } finally { setSibuk(false); }
  }
  return (
    <div className="mt-1.5 space-y-1.5" data-testid="tertunda-ubah-form">
      {baris.map((b, i) => (
        <label key={i} className="flex items-center gap-2 text-[12.5px] text-ink"><span className="min-w-0 flex-1 truncate">{b.bahan || b.kode}</span>
          <input inputMode="decimal" value={qty[i]} onChange={(e) => setQty((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`Jumlah baru ${b.bahan || b.kode}`} data-testid="tertunda-ubah-qty" className={`${INPUT} w-24 text-right`} />
          <span className="w-12 text-[11.5px] text-ink3">{b.satuanInput || b.satuanStok}</span></label>
      ))}
      <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan perubahan (min. 5 karakter)" aria-label="Alasan perubahan" data-testid="tertunda-ubah-alasan" className={`${INPUT} w-full`} />
      {galat && <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>}
      <div className="flex gap-2"><Button size="sm" variant="secondary" className="min-h-[40px]" disabled={sibuk} onClick={onBatal}>Batal</Button>
        <Button size="sm" className="min-h-[40px]" data-testid="tertunda-ubah-kirim" disabled={sibuk || !sah} onClick={kirim}>{sibuk ? "Menyimpan…" : "Simpan perubahan"}</Button></div>
    </div>
  );
}

export default function PemakaianTertunda({ unitId = null, runId = null, besar = false, versi = 0, denganTerverifikasi = false, bolehUbah = true }) {
  const [data, setData] = useState(null); const [sah, setSah] = useState([]); const [galat, setGalat] = useState("");
  const [batal, setBatal] = useState(null); const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false);
  const [ubah, setUbah] = useState(null); const [info, setInfo] = useState("");
  const muat = useCallback(() => {
    if (!unitId && !runId) return;
    api.daftarPengajuanPemakaian({ ...(unitId ? { unitId } : {}), ...(runId ? { runId } : {}) }).then((d) => { setData(d); setGalat(""); }).catch((e) => setGalat(e.message || "Gagal memuat pengajuan"));
    if (denganTerverifikasi && runId) api.pengajuanTerverifikasi(runId).then((d) => setSah(d.pengajuan || [])).catch(() => setSah([]));
  }, [unitId, runId, denganTerverifikasi]);
  useEffect(() => { muat(); }, [muat, versi]);
  useEffect(() => { const f = () => muat(); window.addEventListener(PENGAJUAN_BERUBAH, f); return () => window.removeEventListener(PENGAJUAN_BERUBAH, f); }, [muat]);
  const daftar = data?.pengajuan || [];
  if (galat) return <p role="alert" className="m-0 text-[12px] text-red" data-testid="tertunda-galat">Pengajuan pemakaian tidak terbaca: {galat}</p>;
  if (!daftar.length && !sah.length && !info) return null;
  async function kirimBatal(id) {
    setSibuk(true);
    try { await api.batalkanPengajuanPemakaian(id, { alasan: alasan.trim() }); setBatal(null); setAlasan(""); muat(); }
    catch (e) { setGalat(e.message || "Gagal membatalkan"); } finally { setSibuk(false); }
  }
  const teks = besar ? "text-[14px]" : "text-[12.5px]";
  const bisaUbah = (p) => bolehUbah && (p.jalur === "UNIT_BAHAN" || p.jalur === "BUKTI_V2");
  return (
    <div className="space-y-2">
      {info && <p role="status" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green" data-testid="tertunda-info">{info}</p>}
      {daftar.length > 0 && (
        <section className="rounded-btn border border-orange/40 bg-orangebg/60 p-3" data-testid="pemakaian-tertunda" aria-label="Pemakaian tertunda">
          <h4 className={`m-0 flex items-center gap-1.5 font-semibold text-ink ${besar ? "text-[15px]" : "text-[13px]"}`}><Clock3 size={besar ? 17 : 15} className="shrink-0 text-orange" aria-hidden />Sudah dilaporkan — menunggu verifikasi ADMIN ({daftar.length})</h4>
          <p className={`m-0 mt-0.5 text-ink2 ${besar ? "text-[13px]" : "text-[12px]"}`}>Stok dan HPP belum berubah. Jangan catat ulang bahan yang sama; pekerjaan tetap bisa dilanjutkan. Salah jumlah? Tekan Ubah — langsung tersimpan.</p>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {daftar.map((p) => {
              const milikSaya = data.userId && p.diajukanOleh === data.userId; const tahan = alasanTahan(p);
              return (
                <li key={p.id} className="rounded-btn bg-surface px-2.5 py-2" data-testid="tertunda-baris" data-status={p.status}>
                  <p className={`m-0 font-medium text-ink ${teks}`}>{teksRingkas(p)}</p>
                  <p className="m-0 text-[11.5px] text-ink3">{p.jalurLabel}{p.ringkasan?.tahap ? ` (tahap ${p.ringkasan.tahap})` : ""} · {p.pengaju || "—"} · {waktuSingkat(p.diajukanPada)} · <span className={p.status === "DITAHAN" ? "text-red" : "text-orange"}>{STATUS_TEKS[p.status] || p.status}</span>{p.ringkasan?.ubahSesudahSah ? " · perubahan atas angka yang sudah sah" : ""}</p>
                  {tahan.length > 0 && <p className="m-0 mt-0.5 flex items-start gap-1 text-[11.5px] text-red" data-testid="tertunda-alasan"><ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden />{tahan.join("; ")}</p>}
                  {ubah === p.id ? <FormUbah p={p} onBatal={() => setUbah(null)} onSelesai={(m) => { setUbah(null); setInfo(m || "Perubahan tersimpan."); muat(); }} /> : (
                    <div className="mt-1 flex flex-wrap gap-x-4">
                      {bisaUbah(p) && <button type="button" className="flex min-h-[36px] items-center gap-1 text-[12px] font-medium text-accent" data-testid="tertunda-ubah" onClick={() => { setUbah(p.id); setBatal(null); }}><Pencil size={12} aria-hidden />Ubah</button>}
                      {p.jalur === "RUN_V2" && <span className="py-2 text-[11.5px] text-ink3">Ubah lewat “Catat Racikan & Bahan”.</span>}
                      {milikSaya && batal !== p.id && <button type="button" className="min-h-[36px] text-[12px] font-medium text-accent underline-offset-2 hover:underline" data-testid="tertunda-batal" onClick={() => { setBatal(p.id); setAlasan(""); }}>Batalkan pengajuan saya</button>}
                    </div>
                  )}
                  {batal === p.id && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan pembatalan (min. 5 karakter)" aria-label="Alasan pembatalan" data-testid="tertunda-batal-alasan" className={`${INPUT} flex-1`} />
                      <Button size="sm" variant="secondary" className="min-h-[40px]" disabled={sibuk} onClick={() => setBatal(null)}>Tidak jadi</Button>
                      <Button size="sm" className="min-h-[40px]" data-testid="tertunda-batal-kirim" disabled={sibuk || alasan.trim().length < 5} onClick={() => kirimBatal(p.id)}>Batalkan</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {sah.length > 0 && (
        <section className="rounded-btn border border-line bg-surface p-3" data-testid="pemakaian-terverifikasi" aria-label="Pemakaian bukti yang sudah diverifikasi">
          <h4 className={`m-0 flex items-center gap-1.5 font-semibold text-ink ${besar ? "text-[15px]" : "text-[13px]"}`}><CheckCircle2 size={besar ? 17 : 15} className="shrink-0 text-green" aria-hidden />Pemakaian di bukti tahap — sudah diverifikasi</h4>
          <p className={`m-0 mt-0.5 text-ink2 ${besar ? "text-[13px]" : "text-[12px]"}`}>Bisa diubah. Perubahan diajukan untuk verifikasi ulang ADMIN; angka ini tetap berlaku sampai perubahan disahkan.</p>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {sah.map((p) => (
              <li key={p.id} className="rounded-btn bg-inset px-2.5 py-2" data-testid="terverifikasi-baris">
                <p className={`m-0 font-medium text-ink ${teks}`}>{teksRingkas(p)}</p>
                <p className="m-0 text-[11.5px] text-ink3">Tahap {p.ringkasan?.tahap ?? "—"} · disahkan {waktuSingkat(p.diputuskanPada)}</p>
                {bolehUbah && (ubah === p.id ? <FormUbah p={p} onBatal={() => setUbah(null)} onSelesai={(m) => { setUbah(null); setInfo(m || "Perubahan diajukan."); muat(); }} />
                  : <button type="button" className="mt-1 flex min-h-[36px] items-center gap-1 text-[12px] font-medium text-accent" data-testid="terverifikasi-ubah" onClick={() => setUbah(p.id)}><Pencil size={12} aria-hidden />Ubah (minta verifikasi ulang)</button>)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
