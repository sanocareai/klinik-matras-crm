import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { History, Loader2, Scale, TriangleAlert } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import KoreksiSaldoModal from "./KoreksiSaldoModal.jsx";
import { STATUS_KOREKSI, KEADAAN_SALDO_UI, fmt, tanda } from "./koreksiSaldoLogic.js";

const tanggalJam = (v) => (v ? new Date(v).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// KOREKSI SALDO di drawer bahan (Stok & Lokasi): keadaan saldo yang jujur (belum diketahui ≠ 0 menurut pergerakan ≠ 0 terverifikasi), tombol Koreksi saldo (hanya yang berizin),
// dan riwayat koreksi bahan ini (diajukan/disetujui/diposting oleh siapa, pergerakan yang tercipta, dan penanda KEDALUWARSA bila saldo bergeser).
export default function KoreksiSaldoPanel({ materialId, bahan, onChanged }) {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(""); const [modal, setModal] = useState(false); const [bukaRiwayat, setBukaRiwayat] = useState(false);
  const muat = useCallback(() => { setGalat(""); return api.getKoreksiSaldoBahan(materialId).then(setD).catch((e) => setGalat(e.message)); }, [materialId]);
  useEffect(() => { setD(null); setBukaRiwayat(false); muat(); }, [materialId, muat]);

  if (galat && !d) return <p role="alert" className="mt-3 rounded-btn bg-redbg px-3 py-2 text-[12px] text-red" data-testid="galat-panel-koreksi">{galat}</p>;
  if (!d) return <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat keadaan saldo…</p>;
  const k = KEADAAN_SALDO_UI[d.keadaanSaldo]; const aktif = d.riwayat.find((r) => ["DRAFT", "WAITING_APPROVAL", "APPROVED"].includes(r.status));
  const satuan = String(d.bahan.satuan ?? "").toLowerCase();

  return (
    <section className="mt-4 rounded-btn border border-line p-3" aria-label="Koreksi saldo bahan" data-testid="panel-koreksi-saldo">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ink3"><Scale size={12} aria-hidden /> Saldo &amp; koreksi</h4>
        <Badge variant={k?.varian ?? "neutral"} data-testid="keadaan-saldo" data-keadaan={d.keadaanSaldo}>{k?.singkat ?? d.keadaanSaldo}</Badge>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink2" data-testid="teks-keadaan-saldo">{d.keadaanTeks}{d.verifikasiNol ? ` (${d.verifikasiNol.nomor}, ${tanggalJam(d.verifikasiNol.waktu)})` : ""}</p>
      {aktif && (
        <p className="mt-2 rounded-btn bg-orangebg px-2.5 py-1.5 text-[11.5px] text-ink2" data-testid="koreksi-aktif">
          Ada koreksi saldo yang belum selesai: <Link to={`/warehouse/adjustments/stock/${aktif.id}`} className="font-semibold text-accent hover:underline">{aktif.nomor}</Link> — {aktif.statusTeks}.{aktif.kedaluwarsa && <b className="text-red"> Saldo sudah bergeser — batalkan dan ajukan ulang.</b>}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink3" data-testid="izin-koreksi">{d.izin.teks}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {d.izin.bolehMengajukan && <Button size="sm" onClick={() => setModal(true)} disabled={!!aktif} title={aktif ? "Selesaikan atau batalkan koreksi yang berjalan dulu" : undefined} className="max-sm:min-h-11" data-testid="tombol-koreksi-saldo"><Scale size={13} /> Koreksi saldo</Button>}
        <Button size="sm" variant="secondary" onClick={() => setBukaRiwayat((v) => !v)} className="max-sm:min-h-11" data-testid="tombol-riwayat-koreksi"><History size={13} /> Riwayat koreksi ({d.riwayat.length})</Button>
      </div>
      {bukaRiwayat && (
        <ul className="mt-3 divide-y divide-line" data-testid="riwayat-koreksi">
          {d.riwayat.length === 0 && <li className="py-2 text-[12px] text-ink3">Belum ada koreksi saldo untuk bahan ini.</li>}
          {d.riwayat.map((r) => {
            const st = STATUS_KOREKSI[r.status] ?? { teks: r.statusTeks, varian: "neutral" };
            return (
              <li key={r.id} className="py-2 text-[12px]" data-testid="baris-riwayat-koreksi">
                <div className="flex flex-wrap items-center gap-1.5"><Link to={`/warehouse/adjustments/stock/${r.id}`} className="font-semibold text-accent hover:underline">{r.nomor}</Link><Badge variant={st.varian}>{r.statusTeks}</Badge>{r.kedaluwarsa && <Badge variant="red" data-testid="badge-kedaluwarsa">Kedaluwarsa</Badge>}</div>
                <div className="mt-0.5 text-ink2">Fisik {fmt(r.jumlahFisik)} {satuan} · saldo dilihat {fmt(r.saldoDilihat)} · selisih <b className={r.selisih > 0 ? "text-green" : "text-red"}>{tanda(r.selisih)}</b></div>
                <div className="text-ink3">Alasan: {r.alasan}</div>
                <div className="text-ink3">Diajukan {tanggalJam(r.diajukanPada)} oleh {r.diajukanOleh ?? "—"}{r.disetujuiOleh ? ` · disetujui ${r.disetujuiOleh}` : ""}{r.dipostingOleh ? ` · diposting ${r.dipostingOleh} (${tanggalJam(r.dipostingPada)})` : ""}</div>
                {r.pergerakan && <div className="text-ink3">Pergerakan stok tercipta: {tanda(r.pergerakan.qty)} {satuan}</div>}
                {r.kedaluwarsa && <div className="mt-0.5 flex items-start gap-1 text-red"><TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />{r.kedaluwarsaTeks}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {modal && <KoreksiSaldoModal open onClose={() => { setModal(false); muat(); }} bahan={{ id: d.bahan.id, kode: d.bahan.kode, nama: d.bahan.nama, satuan: d.bahan.satuan }} onDiajukan={() => { muat(); onChanged?.(); }} />}
    </section>
  );
}
