import React, { useCallback, useEffect, useState } from "react";
import { Clock3, ShieldAlert } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { PENGAJUAN_BERUBAH, STATUS_TEKS, alasanTahan, teksRingkas, waktuSingkat } from "@/features/production/pengajuan/pengajuanModel.js";

// PEMAKAIAN TERTUNDA — bahan yang SUDAH DILAPORKAN tetapi belum diverifikasi ADMIN (stok & HPP belum berubah). Tampil terpisah dari pemakaian resmi,
// supaya operator dan admin produksi tahu bahan sudah dilaporkan (tidak dicatat ulang). Pengaju bisa membatalkan pengajuannya sendiri.
export default function PemakaianTertunda({ unitId = null, runId = null, besar = false, versi = 0 }) {
  const [data, setData] = useState(null); const [galat, setGalat] = useState("");
  const [batal, setBatal] = useState(null); const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false);
  const muat = useCallback(() => {
    if (!unitId && !runId) return;
    api.daftarPengajuanPemakaian({ ...(unitId ? { unitId } : {}), ...(runId ? { runId } : {}) }).then((d) => { setData(d); setGalat(""); }).catch((e) => setGalat(e.message || "Gagal memuat pengajuan"));
  }, [unitId, runId]);
  useEffect(() => { muat(); }, [muat, versi]);
  useEffect(() => { const f = () => muat(); window.addEventListener(PENGAJUAN_BERUBAH, f); return () => window.removeEventListener(PENGAJUAN_BERUBAH, f); }, [muat]);
  const daftar = data?.pengajuan || [];
  if (galat) return <p role="alert" className="m-0 text-[12px] text-red" data-testid="tertunda-galat">Pengajuan pemakaian tidak terbaca: {galat}</p>;
  if (!daftar.length) return null;
  async function kirimBatal(id) {
    setSibuk(true);
    try { await api.batalkanPengajuanPemakaian(id, { alasan: alasan.trim() }); setBatal(null); setAlasan(""); muat(); }
    catch (e) { setGalat(e.message || "Gagal membatalkan"); } finally { setSibuk(false); }
  }
  const teks = besar ? "text-[14px]" : "text-[12.5px]";
  return (
    <section className="rounded-btn border border-orange/40 bg-orangebg/60 p-3" data-testid="pemakaian-tertunda" aria-label="Pemakaian tertunda">
      <h4 className={`m-0 flex items-center gap-1.5 font-semibold text-ink ${besar ? "text-[15px]" : "text-[13px]"}`}><Clock3 size={besar ? 17 : 15} className="shrink-0 text-orange" aria-hidden />Sudah dilaporkan — menunggu verifikasi ADMIN ({daftar.length})</h4>
      <p className={`m-0 mt-0.5 text-ink2 ${besar ? "text-[13px]" : "text-[12px]"}`}>Stok dan HPP belum berubah. Jangan catat ulang bahan yang sama; pekerjaan tetap bisa dilanjutkan.</p>
      <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
        {daftar.map((p) => {
          const milikSaya = data.userId && p.diajukanOleh === data.userId; const tahan = alasanTahan(p);
          return (
            <li key={p.id} className="rounded-btn bg-surface px-2.5 py-2" data-testid="tertunda-baris" data-status={p.status}>
              <p className={`m-0 font-medium text-ink ${teks}`}>{teksRingkas(p)}</p>
              <p className="m-0 text-[11.5px] text-ink3">{p.jalurLabel} · {p.pengaju || "—"} · {waktuSingkat(p.diajukanPada)} · <span className={p.status === "DITAHAN" ? "text-red" : "text-orange"}>{STATUS_TEKS[p.status] || p.status}</span></p>
              {tahan.length > 0 && <p className="m-0 mt-0.5 flex items-start gap-1 text-[11.5px] text-red" data-testid="tertunda-alasan"><ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden />{tahan.join("; ")}</p>}
              {milikSaya && batal !== p.id && <button type="button" className="mt-1 min-h-[36px] text-[12px] font-medium text-accent underline-offset-2 hover:underline" data-testid="tertunda-batal" onClick={() => { setBatal(p.id); setAlasan(""); }}>Batalkan pengajuan saya</button>}
              {batal === p.id && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan pembatalan (min. 5 karakter)" aria-label="Alasan pembatalan" data-testid="tertunda-batal-alasan" className="h-10 min-w-0 flex-1 rounded-btn border border-line bg-surface px-2.5 text-[12.5px] text-ink" />
                  <Button size="sm" variant="secondary" className="min-h-[40px]" disabled={sibuk} onClick={() => setBatal(null)}>Tidak jadi</Button>
                  <Button size="sm" className="min-h-[40px]" data-testid="tertunda-batal-kirim" disabled={sibuk || alasan.trim().length < 5} onClick={() => kirimBatal(p.id)}>Batalkan</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
