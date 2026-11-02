import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IkAwas, IkOpname, IkRiwayat } from "@/components/gudangIcons.jsx";
import { api } from "@/api.js";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import KoreksiSaldoModal from "./KoreksiSaldoModal.jsx";
import { STATUS_KOREKSI, KEADAAN_SALDO_UI, fmt, tanda } from "./koreksiSaldoLogic.js";
import { TEKS_DRAWER, peringatanStok } from "./drawerBahanLogic.js";

const tanggalJam = (v) => (v ? new Date(v).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// KOREKSI SALDO di drawer bahan (Stok & Lokasi) — tampilan RINGKAS di dalam kartu Stok: peringatan yang butuh tindakan (saldo minus, stok belum diketahui, koreksi menunggu), tombol Koreksi saldo
// (hanya yang berizin) dan Riwayat. Penjelasan aturan persetujuan + izin ada di ikon informasi; keadaan saldo yang jujur (belum diketahui ≠ 0 menurut pergerakan ≠ 0 terverifikasi) tidak berubah makna.
// Layanan, izin, dan persetujuan sama dengan sebelumnya — hanya tata letak yang diringkas.
export default function KoreksiSaldoPanel({ materialId, onChanged, onKeadaan = null }) {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(""); const [modal, setModal] = useState(false); const [bukaRiwayat, setBukaRiwayat] = useState(false);
  const info = useInfoToggle();
  const muat = useCallback(() => { setGalat(""); return api.getKoreksiSaldoBahan(materialId).then(setD).catch((e) => setGalat(e.message)); }, [materialId]);
  useEffect(() => { setD(null); setBukaRiwayat(false); muat(); }, [materialId, muat]);
  useEffect(() => { onKeadaan?.(d?.keadaanSaldo ?? null); }, [d?.keadaanSaldo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (galat && !d) return <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-panel-koreksi">{galat}</p>;
  if (!d) return <p className="gud-petunjuk" role="status">Memuat keadaan saldo…</p>;
  const k = KEADAAN_SALDO_UI[d.keadaanSaldo]; const aktif = d.riwayat.find((r) => ["DRAFT", "WAITING_APPROVAL", "APPROVED"].includes(r.status));
  const satuan = String(d.bahan.satuan ?? "").toLowerCase();
  const peringatan = peringatanStok({ keadaan: d.keadaanSaldo, aktif });
  const infoNol = d.keadaanSaldo === "NOL_MENURUT_PERGERAKAN" || d.keadaanSaldo === "NOL_TERVERIFIKASI";

  return (
    <div className="gud-koreksi" aria-label="Koreksi saldo bahan" data-testid="panel-koreksi-saldo" data-keadaan={d.keadaanSaldo}>
      {infoNol && <div><span className="gud-pill" data-warna={k?.varian ?? "neutral"} data-testid="keadaan-saldo" data-keadaan={d.keadaanSaldo}>{k?.singkat ?? d.keadaanSaldo}</span></div>}
      {peringatan.map((p) => (
        <p key={p.kode} role="status" data-testid={`peringatan-${p.kode.toLowerCase().replace(/_/g, "-")}`} className="gud-info" data-nada={p.nada === "red" ? "galat" : "awas"}>
          <IkAwas size={16} aria-hidden />
          <span>{p.kode === "KOREKSI_MENUNGGU" ? <>Koreksi saldo <Link to={`/warehouse/adjustments/stock/${p.id}`} className="gud-tautan-nomor" data-testid="koreksi-aktif-tautan">{p.nomor}</Link> {String(aktif?.statusTeks ?? "").toLowerCase()}.{p.tambahan && <b className="gud-merah-teks"> {p.tambahan}</b>}</> : p.teks}</span>
        </p>
      ))}
      <div className="gud-aksi-baris gud-bahan-tombol">
        {d.izin.bolehMengajukan && <button type="button" onClick={() => setModal(true)} disabled={!!aktif} title={aktif ? "Selesaikan atau batalkan koreksi yang berjalan dulu" : undefined} className="gud-tombol" data-testid="tombol-koreksi-saldo"><IkOpname size={16} /> Koreksi saldo</button>}
        <button type="button" onClick={() => setBukaRiwayat((v) => !v)} aria-expanded={bukaRiwayat} className="gud-tombol" data-testid="tombol-riwayat-koreksi"><IkRiwayat size={16} /> Riwayat ({d.riwayat.length})</button>
        <InfoToggleButton info={info} label="aturan koreksi saldo" />
      </div>
      <InfoToggleIsi info={info}>
        <p className="m-0" data-testid="teks-keadaan-saldo">{d.keadaanTeks}{d.verifikasiNol ? ` (${d.verifikasiNol.nomor}, ${tanggalJam(d.verifikasiNol.waktu)})` : ""}</p>
        <p className="m-0">{TEKS_DRAWER.aturanKoreksi}</p>
        <p className="m-0" data-testid="izin-koreksi">{d.izin.teks}</p>
      </InfoToggleIsi>
      {bukaRiwayat && (
        <ul className="gud-riwayat" data-testid="riwayat-koreksi">
          {d.riwayat.length === 0 && <li className="gud-petunjuk">Belum ada koreksi saldo untuk bahan ini.</li>}
          {d.riwayat.map((r) => {
            const st = STATUS_KOREKSI[r.status] ?? { teks: r.statusTeks, varian: "neutral" };
            return (
              <li key={r.id} data-testid="baris-riwayat-koreksi">
                <div className="gud-riwayat-atas"><Link to={`/warehouse/adjustments/stock/${r.id}`} className="gud-tautan-nomor">{r.nomor}</Link><span className="gud-pill" data-warna={st.varian}>{r.statusTeks}</span>{r.kedaluwarsa && <span className="gud-pill" data-warna="red" data-testid="badge-kedaluwarsa">Kedaluwarsa</span>}</div>
                <div className="gud-sekunder">Fisik {fmt(r.jumlahFisik)} {satuan} · saldo dilihat {fmt(r.saldoDilihat)} · selisih <b className={r.selisih > 0 ? "gud-plus" : "gud-minus"}>{tanda(r.selisih)}</b></div>
                <div className="gud-sekunder">Alasan: {r.alasan}</div>
                <div className="gud-sekunder">Diajukan {tanggalJam(r.diajukanPada)} oleh {r.diajukanOleh ?? "—"}{r.disetujuiOleh ? ` · disetujui ${r.disetujuiOleh}` : ""}{r.dipostingOleh ? ` · diposting ${r.dipostingOleh} (${tanggalJam(r.dipostingPada)})` : ""}</div>
                {r.pergerakan && <div className="gud-sekunder">Pergerakan stok tercipta: {tanda(r.pergerakan.qty)} {satuan}</div>}
                {r.kedaluwarsa && <div className="gud-sekunder gud-merah-teks"><IkAwas size={14} aria-hidden /> {r.kedaluwarsaTeks}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {modal && <KoreksiSaldoModal open onClose={() => { setModal(false); muat(); }} bahan={{ id: d.bahan.id, kode: d.bahan.kode, nama: d.bahan.nama, satuan: d.bahan.satuan }} onDiajukan={() => { muat(); onChanged?.(); }} />}
    </div>
  );
}
