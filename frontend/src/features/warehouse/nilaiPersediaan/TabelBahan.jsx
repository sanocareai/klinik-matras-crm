import React, { forwardRef, useEffect, useId, useMemo, useState } from "react";
import FilterPopover from "@/features/warehouse/stok/FilterPopover.jsx";
import { halamanDaftar } from "@/features/warehouse/stok/stokTampilanLogic.js";
import { Glif } from "@/features/warehouse/beranda/IkonApple.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FILTER_SEMUA, saringBaris, teksHarga, teksRupiah, teksSaldo } from "./nilaiPersediaanLogic.js";
import { UKURAN_HALAMAN, chipFilterAktif, kelompokOpsiFilter, statusUtama, teksHasil } from "./nilaiTampilanLogic.js";

// PENCARIAN + SATU TOMBOL FILTER + TABEL. Kategori lengkap di popover (desktop) / lembar bawah (HP); hanya filter aktif tampil sebagai chip. Tabel langsung terlihat:
// bahan · saldo/satuan · harga/satuan · estimasi · SATU status utama. Alasan, sumber harga, riwayat, dan Catat hasil SO ada di drawer baris.
// Pencarian dan filter bekerja pada SATU himpunan baris yang sama dari server; hitungan "n bahan" dan halaman berasal dari SELURUH hasil saringan (halaman hanya memotong tampilan).
const TabelBahan = forwardRef(function TabelBahan({ d, nominal, filter, setFilter, cari, setCari, dipilihId, onPilih }, ref) {
  const nama = useId(); const [nomor, setNomor] = useState(1);
  const hasil = useMemo(() => saringBaris(d.baris, { filter, cari }), [d.baris, filter, cari]);
  useEffect(() => { setNomor(1); }, [filter, cari]);
  const h = halamanDaftar(hasil, nomor, UKURAN_HALAMAN);
  const chip = chipFilterAktif(filter, d.cakupan);
  const kelompok = useMemo(() => kelompokOpsiFilter(d.cakupan), [d.cakupan]);

  return (
    <section className="gud-panel nip-panel" aria-label="Daftar bahan" ref={ref} data-testid="np-panel">
      <div className="nip-alat">
        <label className="nip-cari">
          <Glif nama="cari" size={17} />
          <input type="search" placeholder="Cari kode atau nama bahan…" value={cari} onChange={(e) => setCari(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setCari(""); }} aria-label="Cari bahan" data-testid="np-cari" autoComplete="off" />
          {cari && <button type="button" className="nip-hapus-cari" onClick={() => setCari("")} aria-label="Hapus pencarian"><Glif nama="tutup" size={13} /></button>}
        </label>
        <div className="nip-filter">
          <FilterPopover jumlah={chip ? 1 : 0} onReset={() => setFilter(FILTER_SEMUA)}>
            {kelompok.map((g) => (
              <fieldset className="nip-grup" key={g.judul} data-testid={`np-grup-${g.judul.split(" ")[0].toLowerCase()}`}>
                <legend className="gud-filter-label">{g.judul}</legend>
                {g.opsi.map((o) => (
                  <label key={o.kode} className="nip-opsi"><input type="radio" name={`${nama}-status`} checked={filter === o.kode} onChange={() => setFilter(o.kode)} data-testid={`np-filter-${o.kode}`} /><span className="nip-opsi-teks">{o.teks}</span><span className="nip-opsi-n">{o.jumlah}</span></label>
                ))}
              </fieldset>
            ))}
          </FilterPopover>
        </div>
      </div>

      {chip && (
        <div className="nip-chip-baris" data-testid="np-chip-aktif" aria-label="Filter aktif">
          <span className="nip-fchip" data-testid="np-chip-filter">{chip.teks}{chip.jumlah != null && <b>{chip.jumlah}</b>}<button type="button" onClick={() => setFilter(FILTER_SEMUA)} aria-label={`Hapus filter ${chip.teks}`}><Glif nama="tutup" size={11} /></button></span>
          <button type="button" className="nip-taut" onClick={() => setFilter(FILTER_SEMUA)} data-testid="np-semua-bahan">Tampilkan semua bahan</button>
        </div>
      )}

      <p className="nip-hasil" aria-live="polite" data-testid="np-hasil">{teksHasil({ total: h.total, dari: h.dari, sampai: h.sampai, cari, chip: null })}</p>

      {h.baris.length === 0 ? <EmptyState title="Tidak ada bahan pada filter ini" /> : (
        <div className="nip-gulir">
          <table className="nip-tabel" data-testid="np-tabel">
            <thead><tr><th>Bahan</th><th className="nip-n">Saldo</th><th className="nip-n">Harga / satuan</th><th className="nip-n">Estimasi</th><th>Status</th></tr></thead>
            <tbody>
              {h.baris.map((b) => {
                const s = statusUtama(b); const dipilih = dipilihId === b.materialId;
                return (
                  <tr key={b.materialId} data-testid="np-baris" data-status={b.status} data-sub={b.subStatus ?? ""} data-kode={b.kode} data-dipilih={dipilih ? "ya" : "tidak"} onClick={() => onPilih(b)}>
                    <td className="nip-td-nama" data-label="Bahan"><button type="button" className="nip-nama-btn" onClick={(e) => { e.stopPropagation(); onPilih(b); }} aria-label={`Buka rincian ${b.nama}`} aria-haspopup="dialog" data-testid="np-buka-baris"><span className="nip-nama">{b.nama}</span></button><span className="nip-kode">{b.kode}</span></td>
                    <td className="nip-n nip-td-saldo" data-label="Saldo"><span className="nip-lbl">Saldo</span>{b.saldo === null ? <span className="nip-belum">belum diketahui</span> : teksSaldo(b.saldo, b.satuan)}</td>
                    <td className="nip-n nip-td-harga" data-label="Harga / satuan"><span className="nip-lbl">Harga</span>{teksHarga(b.harga, b.satuan) ?? <span className="nip-belum">{nominal ? "belum ada" : "—"}</span>}</td>
                    <td className="nip-n nip-td-est" data-label="Estimasi"><span className="nip-lbl">Estimasi</span>{b.nilai === null || (!nominal && b.status === "DINILAI") ? <span className="nip-belum">{b.status === "DINILAI" ? "—" : "tidak dinilai"}</span> : teksRupiah(b.nilai)}</td>
                    <td className="nip-td-status" data-label="Status"><span className={`nip-pil-status nip-${s.nada}`} data-testid="np-status"><i className="nip-titik" aria-hidden="true" />{s.teks}</span>{s.peringatanSO && <span className="nip-so-tanda" role="img" aria-label="Catatan SO kedaluwarsa" title="Catatan SO kedaluwarsa"><Glif nama="awas" size={15} /></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {h.jumlahHalaman > 1 && (
        <nav className="nip-halaman" aria-label="Halaman daftar" data-testid="np-halaman">
          <button type="button" onClick={() => setNomor(h.halaman - 1)} disabled={h.halaman <= 1} data-testid="np-sebelumnya"><Glif nama="kanan" size={14} className="nip-balik" /> Sebelumnya</button>
          <span data-testid="np-nomor-halaman">Halaman {h.halaman} dari {h.jumlahHalaman}</span>
          <button type="button" onClick={() => setNomor(h.halaman + 1)} disabled={h.halaman >= h.jumlahHalaman} data-testid="np-berikutnya">Berikutnya <Glif nama="kanan" size={14} /></button>
        </nav>
      )}
    </section>
  );
});
export default TabelBahan;
