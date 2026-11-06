import React, { useEffect, useState } from "react";
import { api } from "@/api.js";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import { Glif } from "@/features/warehouse/beranda/IkonApple.jsx";
import CatatHasilSOModal from "./CatatHasilSOModal.jsx";
import { statusUtama, topengNominal } from "./nilaiTampilanLogic.js";
import { JENIS_HASIL_SO, ringkasHasilSO, ringkasVerifikasiNol, teksDokumenHarga, teksHarga, teksRupiah, teksSaldo, teksSumberHarga, teksTanggalSO, teksWaktuWIB, TEKS_RINCIAN_NOL } from "./nilaiPersediaanLogic.js";

// DRAWER BARIS — semua detail yang tidak perlu ada di tabel: alasan status, angka, sumber harga (jejak penelusuran, BUKAN bukti biaya perolehan; "belum diverifikasi"), catatan hasil SO terkini,
// riwayat hasil SO (baca-saja, GET /inventory/nilai-persediaan/hasil-so/:id), dan tombol Catat/Koreksi hasil SO (hanya bila berizin; server tetap menegakkan inventory:write, form meminta konfirmasi Simpan).
// Memakai FokusOverlay mode tempel: panel kanan ≥1200px, jendela fokus di lebar menengah, layar penuh di HP; formulir Catat hasil SO tampil sebagai panel di lapisan yang sama.

function Baris({ label, children, testid }) { return <div className="nipd-baris" data-testid={testid}><dt>{label}</dt><dd>{children}</dd></div>; }

function Riwayat({ materialId, versi }) {
  const [r, setR] = useState(null); const [galat, setGalat] = useState("");
  useEffect(() => {
    let batal = false; setR(null); setGalat("");
    api.getRiwayatHasilSO(materialId).then((x) => { if (!batal) setR(x.riwayat ?? []); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat riwayat"); });
    return () => { batal = true; };
  }, [materialId, versi]);
  if (galat) return <p className="nipd-galat" role="alert" data-testid="np-riwayat-galat">{galat}</p>;
  if (!r) return <p className="nipd-sekunder" data-testid="np-riwayat-memuat">Memuat riwayat…</p>;
  if (r.length === 0) return <p className="nipd-sekunder" data-testid="np-riwayat-kosong">Belum ada catatan hasil SO untuk bahan ini.</p>;
  return (
    <ol className="nipd-riwayat" data-testid="np-riwayat">{[...r].reverse().map((x) => (
      <li key={x.id} data-testid="np-riwayat-item">
        <div className="nipd-riwayat-atas"><b>{x.koreksi ? "Koreksi" : "Catatan"} · {JENIS_HASIL_SO[x.jenis] ?? x.jenis}{x.jenis === "PENGAMATAN_SATUAN" ? ` · ${x.jumlah} ${x.satuan}` : ""}</b>{x.terkini && <span className="nipd-terkini">terkini</span>}</div>
        <div className="nipd-sekunder">SO {teksTanggalSO(x.soTanggal)} · {x.pelaku?.nama ?? "—"} · dicatat {teksWaktuWIB(x.dicatatPada)}</div>
        <div className="nipd-sekunder">Sumber: {x.sumber}</div>
        <div className="nipd-sekunder">Alasan: {x.alasan}</div>
      </li>))}
    </ol>
  );
}

export default function DrawerBahan({ bahan, nominal, bisaCatat, onTutup, onTersimpan, versi }) {
  const [catat, setCatat] = useState(false);
  useEffect(() => { setCatat(false); }, [bahan?.materialId]);
  if (!bahan) return null;
  const s = statusUtama(bahan); const so = ringkasHasilSO(bahan.hasilSO); const vn = ringkasVerifikasiNol(bahan.verifikasiNol);
  const footer = bisaCatat ? <button type="button" className="nipd-tombol" onClick={() => setCatat(true)} data-testid="np-catat">{bahan.hasilSO ? "Koreksi hasil SO" : "Catat hasil SO"}</button> : null;
  return (
    <FokusOverlay open onClose={onTutup} tempel title={bahan.nama} subtitle={`${bahan.kode} · satuan stok ${bahan.satuan}`} testid="np-drawer" className="nipd" footer={footer}>
      <div className="nipd-isi">
        <div className="nipd-status"><span className={`nip-pil-status nip-${s.nada}`} data-testid="np-drawer-status"><i className="nip-titik" aria-hidden="true" />{s.teks}</span></div>
        {bahan.keterangan && <p className="nipd-alasan" data-testid="np-drawer-alasan">{topengNominal(bahan.keterangan, nominal)}</p>}

        <h3 className="nipd-judul">Angka</h3>
        <dl className="nipd-dl">
          <Baris label="Saldo stok">{bahan.saldo === null ? <span className="nip-belum">belum diketahui</span> : teksSaldo(bahan.saldo, bahan.satuan)}</Baris>
          {bahan.status === "PENGAMATAN_FISIK" && <Baris label="Terukur" testid="np-terukur"><span>terukur: {bahan.pengamatan} · belum terukur dalam {bahan.satuan}</span></Baris>}
          <Baris label="Harga Berlaku">{teksHarga(bahan.harga, bahan.satuan) ?? <span className="nip-belum">{nominal ? "belum ada" : "—"}</span>}</Baris>
          <Baris label="Estimasi nilai">{bahan.nilai === null || (!nominal && bahan.status === "DINILAI") ? <span className="nip-belum">{bahan.status === "DINILAI" ? "—" : "tidak dinilai"}</span> : teksRupiah(bahan.nilai)}</Baris>
        </dl>

        {bahan.harga && (
          <>
            <h3 className="nipd-judul">Sumber harga</h3>
            <dl className="nipd-dl">
              <Baris label="Jenis">{teksSumberHarga(bahan.harga.sumber) || "—"}</Baris>
              <Baris label="Dokumen" testid="np-harga-dokumen">{teksDokumenHarga(bahan.harga)}</Baris>
            </dl>
            <p className="nipd-sekunder">Dokumen sumber adalah jejak penelusuran, bukan bukti biaya perolehan.</p>
          </>
        )}

        {(so || vn) && (
          <>
            <h3 className="nipd-judul">Hasil SO terkini</h3>
            {so && <p className={`nipd-so${so.kedaluwarsa ? " nipd-so-lama" : ""}`} data-testid="np-so" data-kedaluwarsa={so.kedaluwarsa ? "1" : "0"}>{so.kedaluwarsa && <b>Kedaluwarsa · </b>}{so.teks}</p>}
            {vn && <p className="nipd-so" data-testid="np-verif-nol"><b>{TEKS_RINCIAN_NOL}:</b> {vn.label}</p>}
          </>
        )}

        <h3 className="nipd-judul"><Glif nama="riwayat" size={16} /> Riwayat hasil SO</h3>
        <Riwayat materialId={bahan.materialId} versi={versi} />
      </div>
      {catat && <CatatHasilSOModal key={bahan.materialId} open bahan={bahan} onClose={() => setCatat(false)} onTersimpan={onTersimpan} />}
    </FokusOverlay>
  );
}
