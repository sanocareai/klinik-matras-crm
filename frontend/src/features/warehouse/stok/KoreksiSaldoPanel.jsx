import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { History, Loader2, Scale, TriangleAlert } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import KoreksiSaldoModal from "./KoreksiSaldoModal.jsx";
import { STATUS_KOREKSI, KEADAAN_SALDO_UI, fmt, tanda } from "./koreksiSaldoLogic.js";
import { TEKS_DRAWER, peringatanStok } from "./drawerBahanLogic.js";

const tanggalJam = (v) => (v ? new Date(v).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// KOREKSI SALDO di drawer bahan (Stok & Lokasi) — tampilan RINGKAS di dalam kartu Stok: peringatan yang butuh tindakan (saldo minus, stok belum diketahui, koreksi menunggu), tombol Koreksi saldo
// (hanya yang berizin) dan Riwayat. Penjelasan aturan persetujuan + izin ada di ikon informasi; keadaan saldo yang jujur (belum diketahui ≠ 0 menurut pergerakan ≠ 0 terverifikasi) tidak berubah makna.
// Layanan, izin, dan persetujuan sama dengan sebelumnya — hanya tata letak yang diringkas.
export default function KoreksiSaldoPanel({ materialId, onChanged }) {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(""); const [modal, setModal] = useState(false); const [bukaRiwayat, setBukaRiwayat] = useState(false);
  const info = useInfoToggle();
  const muat = useCallback(() => { setGalat(""); return api.getKoreksiSaldoBahan(materialId).then(setD).catch((e) => setGalat(e.message)); }, [materialId]);
  useEffect(() => { setD(null); setBukaRiwayat(false); muat(); }, [materialId, muat]);

  if (galat && !d) return <p role="alert" className="mt-3 rounded-btn bg-redbg px-3 py-2 text-[12px] text-red" data-testid="galat-panel-koreksi">{galat}</p>;
  if (!d) return <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat keadaan saldo…</p>;
  const k = KEADAAN_SALDO_UI[d.keadaanSaldo]; const aktif = d.riwayat.find((r) => ["DRAFT", "WAITING_APPROVAL", "APPROVED"].includes(r.status));
  const satuan = String(d.bahan.satuan ?? "").toLowerCase();
  const peringatan = peringatanStok({ keadaan: d.keadaanSaldo, aktif });
  const infoNol = d.keadaanSaldo === "NOL_MENURUT_PERGERAKAN" || d.keadaanSaldo === "NOL_TERVERIFIKASI";

  return (
    <div className="mt-3 border-t border-line pt-3" aria-label="Koreksi saldo bahan" data-testid="panel-koreksi-saldo" data-keadaan={d.keadaanSaldo}>
      {infoNol && <div className="mb-2"><Badge variant={k?.varian ?? "neutral"} data-testid="keadaan-saldo" data-keadaan={d.keadaanSaldo}>{k?.singkat ?? d.keadaanSaldo}</Badge></div>}
      {peringatan.map((p) => (
        <p key={p.kode} role="status" data-testid={`peringatan-${p.kode.toLowerCase().replace(/_/g, "-")}`} className={`mb-2 flex items-start gap-2 rounded-btn px-2.5 py-1.5 text-[12px] ${p.nada === "red" ? "bg-redbg text-red" : "bg-orangebg text-ink"}`}>
          <TriangleAlert size={13} className={`mt-0.5 shrink-0 ${p.nada === "red" ? "text-red" : "text-orange"}`} aria-hidden />
          <span>{p.kode === "KOREKSI_MENUNGGU" ? <>Koreksi saldo <Link to={`/warehouse/adjustments/stock/${p.id}`} className="font-semibold text-accent hover:underline" data-testid="koreksi-aktif-tautan">{p.nomor}</Link> {String(aktif?.statusTeks ?? "").toLowerCase()}.{p.tambahan && <b className="text-red"> {p.tambahan}</b>}</> : p.teks}</span>
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {d.izin.bolehMengajukan && <Button size="sm" onClick={() => setModal(true)} disabled={!!aktif} title={aktif ? "Selesaikan atau batalkan koreksi yang berjalan dulu" : undefined} className="max-sm:min-h-11" data-testid="tombol-koreksi-saldo"><Scale size={13} /> Koreksi saldo</Button>}
        <Button size="sm" variant="secondary" onClick={() => setBukaRiwayat((v) => !v)} aria-expanded={bukaRiwayat} className="max-sm:min-h-11" data-testid="tombol-riwayat-koreksi"><History size={13} /> Riwayat ({d.riwayat.length})</Button>
        <InfoToggleButton info={info} label="aturan koreksi saldo" />
      </div>
      <InfoToggleIsi info={info}>
        <p className="m-0" data-testid="teks-keadaan-saldo">{d.keadaanTeks}{d.verifikasiNol ? ` (${d.verifikasiNol.nomor}, ${tanggalJam(d.verifikasiNol.waktu)})` : ""}</p>
        <p className="m-0">{TEKS_DRAWER.aturanKoreksi}</p>
        <p className="m-0" data-testid="izin-koreksi">{d.izin.teks}</p>
      </InfoToggleIsi>
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
    </div>
  );
}
