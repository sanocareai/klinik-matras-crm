import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import Lipat from "@/features/warehouse/stok/Lipat.jsx";
import CatatHasilSOModal from "@/features/warehouse/nilaiPersediaan/CatatHasilSOModal.jsx";
import { rolesOf } from "@/lib/roles.js";
import {
  FILTER_PENGECUALIAN, STATUS_NADA, STATUS_PENGECUALIAN, STATUS_REKON_TEKS, STATUS_TEKS, TEKS_TANPA_NOMINAL, kalimatCakupan, opsiFilter, saringBaris, segmenCakupan,
  teksHarga, teksRupiah, teksSaldo, teksSumberHarga, teksWaktuWIB, TEKS_BELUM_FINAL, TEKS_NILAI_PARSIAL, ringkasHasilSO, ringkasVerifikasiNol, TEKS_RINCIAN_NOL,
} from "@/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js";

// NILAI PERSEDIAAN (kandidat, BACA-SAJA). Tiga kartu: Estimasi nilai stok · Saldo akun persediaan Finance (belum direkonsiliasi) · Bahan belum bisa dinilai.
// Tabel: bahan, saldo/satuan, Harga Berlaku, estimasi nilai, status. Rincian bukti Finance di bagian terlipat. Semua angka dari server; halaman ini tidak menghitung nilai.
const BATAS_BARIS = 300;
function pengguna() { try { return JSON.parse(localStorage.getItem("user")) || {}; } catch { return {}; } }
// Petunjuk tampilan saja: izin sebenarnya (inventory:write) ditegakkan server.
const bolehCatat = () => rolesOf(pengguna()).some((r) => ["ADMIN", "OWNER", "WAREHOUSE"].includes(r));

function Chip({ status, children }) { return <span className={`nip-chip nip-${STATUS_NADA[status] ?? "netral"}`}>{children ?? STATUS_TEKS[status]}</span>; }

export default function WarehouseNilaiPersediaan() {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true);
  const [filter, setFilter] = useState(FILTER_PENGECUALIAN); const [cari, setCari] = useState("");
  const muat = useCallback(() => { setMemuat(true); setGalat(""); api.getNilaiPersediaan().then(setD).catch((e) => setGalat(e.message || "Gagal memuat")).finally(() => setMemuat(false)); }, []);
  useEffect(() => { muat(); }, [muat]);

  const baris = useMemo(() => saringBaris(d?.baris, { filter, cari }), [d, filter, cari]);
  const tampil = baris.slice(0, BATAS_BARIS);
  const nominal = !!d?.izin?.nominal; const bisaCatat = bolehCatat(); const [pilih, setPilih] = useState(null);

  return (
    <PageContainer fluid>
      <PageHeader title="Nilai Persediaan" subtitle="Estimasi nilai stok, saldo akun Finance, dan bahan yang belum bisa dinilai — pada satu waktu acuan." actions={<Button variant="secondary" size="sm" onClick={muat} disabled={memuat} data-testid="np-muat"><RefreshCw size={14} /> Muat ulang</Button>} />
      <PageBody>
        {galat && <div className="nip-galat" role="alert" data-testid="np-galat">{galat}</div>}
        {!d && memuat && <div className="nip-memuat" data-testid="np-memuat">Menghitung dari saldo dan Harga Berlaku…</div>}
        {d && (<>
          <div className="nip-waktu" data-testid="np-waktu">Data per <b>{teksWaktuWIB(d.waktuAcuan)}</b> · saldo stok dan Harga Berlaku memakai waktu yang sama · dihitung {teksWaktuWIB(d.waktuHitung)}</div>

          <div className="nip-kartu" data-testid="np-kartu">
            <section className="nip-k nip-k1" data-testid="np-k1" aria-label="Estimasi nilai stok">
              <h3>Estimasi nilai stok</h3>
              <div className="nip-besar" data-testid="np-k1-nilai">{nominal ? teksRupiah(d.kartu.estimasi.nilaiLedger) : "—"}</div>
              <p className="nip-kecil" data-testid="np-k1-label">Berdasarkan ledger (saldo × Harga Berlaku).</p>
              <p><span className="nip-chip nip-waspada" data-testid="np-k1-status">Belum direkonsiliasi dengan hasil SO</span></p>
              <p className="nip-kecil">{TEKS_BELUM_FINAL}</p>
              <p className="nip-kecil" data-testid="np-k1-tanpa">Tanpa hasil SO bermasalah: <b>{nominal ? teksRupiah(d.kartu.estimasi.nilaiTanpaHasilSOBermasalah) : "—"}</b> · {d.kartu.estimasi.bahanHasilSOBermasalah} bahan dikecualikan{nominal && d.kartu.estimasi.bahanHasilSOBermasalah > 0 ? ` (${teksRupiah(d.kartu.estimasi.nilaiHasilSOBermasalah)})` : ""}</p>
              <p className="nip-kecil"><b>{d.kartu.estimasi.bahanDinilai}</b> dari <b>{d.kartu.estimasi.bahanRelevan}</b> bahan relevan dinilai{d.kartu.estimasi.dariPO > 0 ? ` · ${d.kartu.estimasi.dariPO} memakai harga dari PO (belum tentu diterima)` : ""}</p>
              {!nominal && <p className="nip-kecil nip-batas" data-testid="np-tanpa-nominal">{TEKS_TANPA_NOMINAL}</p>}
            </section>
            <section className="nip-k nip-k2" data-testid="np-k2" aria-label="Saldo akun persediaan Finance">
              <h3>Saldo akun persediaan Finance</h3>
              <div className="nip-besar" data-testid="np-k2-nilai">{nominal ? teksRupiah(d.kartu.finance.saldo) : "—"}</div>
              <p><Chip status="PENGAMATAN_FISIK">{STATUS_REKON_TEKS[d.kartu.finance.status] ?? d.kartu.finance.status}</Chip></p>
              <p className="nip-kecil">{d.finance.akun ? `Akun ${d.finance.akun.kode} ${d.finance.akun.nama}` : "Akun persediaan belum disiapkan"} · {d.finance.jurnal} jurnal sampai {d.finance.tanggalBuku}. Tidak dialokasikan ke bahan.</p>
              {!nominal && <p className="nip-kecil nip-batas">{TEKS_TANPA_NOMINAL}</p>}
            </section>
            <section className="nip-k nip-k3" data-testid="np-k3" aria-label="Bahan belum bisa dinilai">
              <h3>Bahan belum bisa dinilai</h3>
              <div className="nip-besar" data-testid="np-k3-jumlah">{d.kartu.belumDinilai.jumlah}</div>
              <p className="nip-chips">{STATUS_PENGECUALIAN.filter((s) => d.kartu.belumDinilai.perStatus[s] > 0).map((s) => <Chip key={s} status={s}>{d.kartu.belumDinilai.perStatus[s]} {STATUS_TEKS[s].toLowerCase()}</Chip>)}</p>
              <p className="nip-kecil">{d.kartu.belumDinilai.catatan} Tetap dihitung di cakupan, tidak disembunyikan.</p>
              {d.kartu.belumDinilai.nolDikonfirmasiBelumDiLedger > 0 && <p className="nip-kecil" data-testid="np-k3-nol">{d.kartu.belumDinilai.nolDikonfirmasiBelumDiLedger} bahan: fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count; belum tercatat sebagai hasil SO di ledger.</p>}
              {(d.cakupan.pengecualianSatuanTerbuka > 0 || d.cakupan.hasilSOKedaluwarsa > 0) && <p className="nip-kecil" data-testid="np-k3-so">{d.cakupan.pengecualianSatuanTerbuka} pengecualian satuan masih terbuka · {d.cakupan.hasilSOKedaluwarsa} catatan SO kedaluwarsa (ada pergerakan sesudah tanggal SO).</p>}
            </section>
          </div>

          <div className="nip-cakupan" data-testid="np-cakupan">
            <div className="nip-strip" role="img" aria-label={kalimatCakupan(d.cakupan)}>{segmenCakupan(d.cakupan).map((s) => <i key={s.status} className={`nip-seg nip-bg-${s.nada}`} style={{ width: `${s.persen}%` }} title={`${s.teks}: ${s.jumlah}`} />)}</div>
            <p className="nip-kalimat"><b>Cakupan:</b> {kalimatCakupan(d.cakupan)}. Saldo nol sah: {d.cakupan.saldoNol}. Seluruh {d.cakupan.universe} bahan dalam laporan.</p>
            <Lipat judul="Definisi dan sumber angka" testid="np-definisi">
              <ul className="nip-def"><li><b>Estimasi nilai stok.</b> {d.definisi.estimasi}</li><li><b>Berdasarkan ledger.</b> {d.definisi.ledger}</li><li><b>Tanpa hasil SO bermasalah.</b> {d.definisi.tanpaBermasalah}</li><li><b>Hasil SO.</b> {d.definisi.hasilSO}</li><li data-testid="np-izin-nominal"><b>Siapa melihat nominal.</b> {d.izin.keterangan} Peran: {d.izin.peranPelihatNominal.join(", ")}.</li><li><b>Saldo akun Finance.</b> {d.definisi.finance}</li><li><b>Bahan relevan.</b> {d.definisi.relevan}</li><li><b>Waktu acuan.</b> {d.definisi.waktu}</li></ul>
            </Lipat>
          </div>

          <div className="nip-tabelbox">
            <div className="nip-alat">
              <input className="nip-cari" type="search" placeholder="Cari kode atau nama bahan…" value={cari} onChange={(e) => setCari(e.target.value)} aria-label="Cari bahan" data-testid="np-cari" />
              <div className="nip-filter" role="group" aria-label="Saring status">{opsiFilter(d.cakupan).map((o) => <button key={o.kode} type="button" aria-pressed={filter === o.kode} onClick={() => setFilter(o.kode)} data-testid={`np-filter-${o.kode}`}>{o.teks} <span>{o.jumlah}</span></button>)}</div>
            </div>
            {tampil.length === 0 ? <EmptyState title="Tidak ada bahan pada saringan ini" /> : (
              <div className="nip-gulir"><table className="nip-tabel" data-testid="np-tabel"><thead><tr><th>Bahan</th><th className="nip-n">Saldo</th><th className="nip-n">Harga Berlaku</th><th className="nip-n">Estimasi nilai</th><th>Status</th>{bisaCatat && <th aria-label="Aksi" />}</tr></thead>
                <tbody>{tampil.map((b) => (
                  <tr key={b.materialId} data-testid="np-baris" data-status={b.status} data-kode={b.kode}>
                    <td data-label="Bahan"><div className="nip-nama">{b.nama}</div><div className="nip-kode">{b.kode}</div></td>
                    <td className="nip-n" data-label="Saldo">{b.saldo === null ? <span className="nip-belum">belum diketahui</span> : teksSaldo(b.saldo, b.satuan)}{b.status === "PENGAMATAN_FISIK" && <div className="nip-kode" data-testid="np-terukur">terukur: {b.pengamatan} · belum terukur dalam {b.satuan}</div>}</td>
                    <td className="nip-n" data-label="Harga Berlaku">{teksHarga(b.harga, b.satuan) ?? <span className="nip-belum">{nominal ? "belum ada" : "—"}</span>}{b.harga && <div className="nip-kode">{teksSumberHarga(b.harga.sumber)}</div>}</td>
                    <td className="nip-n" data-label="Estimasi nilai">{b.nilai === null || (!nominal && b.status === "DINILAI") ? <span className="nip-belum">{b.status === "DINILAI" ? "—" : "tidak dinilai"}</span> : teksRupiah(b.nilai)}</td>
                    <td data-label="Status"><Chip status={b.status} />{b.keterangan && <div className="nip-kode nip-ket">{b.keterangan}</div>}{b.verifikasiNol && (() => { const r = ringkasVerifikasiNol(b.verifikasiNol); return <div className="nip-kode nip-so" data-testid="np-verif-nol"><b>{TEKS_RINCIAN_NOL}:</b> {r.label}</div>; })()}{b.hasilSO && (() => { const r = ringkasHasilSO(b.hasilSO); return <div className={`nip-kode nip-so${r.kedaluwarsa ? " nip-so-lama" : ""}`} data-testid="np-so" data-kedaluwarsa={r.kedaluwarsa ? "1" : "0"}>{r.kedaluwarsa && <b>Kedaluwarsa · </b>}{r.teks}</div>; })()}</td>
                    {bisaCatat && <td data-label="Aksi"><button type="button" className="nip-aksi" onClick={() => setPilih(b)} data-testid="np-catat">{b.hasilSO ? "Koreksi hasil SO" : "Catat hasil SO"}</button></td>}
                  </tr>))}</tbody></table></div>)}
            {baris.length > tampil.length && <p className="nip-kecil nip-batas">Menampilkan {tampil.length} dari {baris.length} baris — persempit dengan pencarian atau saringan.</p>}
          </div>

          <Lipat judul="Rincian bukti Finance" ringkas={`${d.finance.bukti.berbukti} berbukti · ${d.finance.bukti.sebagian} sebagian · ${d.finance.bukti.tanpaBukti} tanpa bukti`} testid="np-bukti">
            <div className="nip-bukti">
              <p className="nip-kecil">{d.finance.bukti.catatan} Saldo akun <b>tidak</b> dibagi ke bahan; tabel ini hanya menunjukkan ada/tidaknya bukti biaya perolehan dari penerimaan berharga.</p>
              <h4>Penyebab belum direkonsiliasi</h4><ul data-testid="np-alasan">{d.finance.alasan.map((a) => <li key={a}>{a}</li>)}</ul>
              <h4>Nilai parsial berdasarkan biaya penerimaan terakhir</h4><p className="nip-kecil" data-testid="np-parsial">{nominal ? <b>{teksRupiah(d.finance.nilaiParsial.nilai)}</b> : "—"} untuk {d.finance.nilaiParsial.bahanDenganBiaya} bahan aktif yang pernah punya biaya penerimaan ({d.finance.nilaiParsial.bahanTanpaBiaya} tidak){nominal ? `; bagian saldo minus ${teksRupiah(d.finance.nilaiParsial.bagianSaldoMinus)}` : ""}. {TEKS_NILAI_PARSIAL}</p>
              <h4>Saldo akun per sumber jurnal</h4>
              {d.finance.perSumber.length === 0 ? <p className="nip-kecil">Belum ada jurnal pada akun ini.</p> : <table className="nip-tabel nip-kecil-tabel"><thead><tr><th>Sumber</th><th className="nip-n">Jurnal</th><th>Periode</th>{nominal && <th className="nip-n">Debit</th>}{nominal && <th className="nip-n">Kredit</th>}</tr></thead><tbody>{d.finance.perSumber.map((s) => <tr key={s.sumber}><td>{s.sumber}</td><td className="nip-n">{s.jurnal}</td><td>{s.awal} – {s.akhir}</td>{nominal && <td className="nip-n">{teksRupiah(s.debit)}</td>}{nominal && <td className="nip-n">{teksRupiah(s.kredit)}</td>}</tr>)}</tbody></table>}
              {d.finance.persediaanAwal && <p className="nip-kecil">Persediaan Awal {d.finance.persediaanAwal.nomor}: <b>{d.finance.persediaanAwal.status}</b> (cutover {d.finance.persediaanAwal.cutover}).</p>}
              {nominal && d.finance.pembandingLedger && <p className="nip-kecil">Pembanding: jumlah biaya penerimaan berharga di ledger stok {teksRupiah(d.finance.pembandingLedger.totalBiayaPenerimaanBerharga)}; selisih dengan saldo akun {teksRupiah(d.finance.pembandingLedger.selisihDenganSaldoAkun)}.</p>}
              <h4>Bukti harga per bahan (bahan bersaldo)</h4>
              <div className="nip-gulir nip-gulir-pendek"><table className="nip-tabel nip-kecil-tabel" data-testid="np-bukti-tabel"><thead><tr><th>Bahan</th><th className="nip-n">Saldo</th><th className="nip-n">Qty berbukti</th><th className="nip-n">Qty tanpa bukti</th><th className="nip-n">GR</th>{nominal && <th className="nip-n">Biaya rata-rata</th>}{nominal && <th className="nip-n">Harga Berlaku*</th>}</tr></thead>
                <tbody>{d.finance.bukti.rincian.slice(0, 400).map((r) => <tr key={r.materialId}><td><div className="nip-nama">{r.nama}</div><div className="nip-kode">{r.kode}</div></td><td className="nip-n">{teksSaldo(r.saldo, r.satuan)}</td><td className="nip-n">{teksSaldo(r.qtyBerbukti, r.satuan)}</td><td className="nip-n">{r.qtyTanpaBukti > 0 ? <span className="nip-chip nip-waspada">{teksSaldo(r.qtyTanpaBukti, r.satuan)}</span> : "—"}</td><td className="nip-n">{r.jumlahGR}</td>{nominal && <td className="nip-n">{r.biayaRata2 === null ? "tidak ada" : teksRupiah(r.biayaRata2)}</td>}{nominal && <td className="nip-n">{r.hargaBerlaku === null ? "—" : teksRupiah(r.hargaBerlaku)}</td>}</tr>)}</tbody></table></div>
              {nominal && <p className="nip-kecil">*Harga Berlaku adalah harga kerja Gudang, <b>bukan</b> bukti perolehan Finance.</p>}
            </div>
          </Lipat>
        </>)}
      </PageBody>
      {pilih && <CatatHasilSOModal key={pilih.materialId} open bahan={pilih} onClose={() => setPilih(null)} onTersimpan={muat} />}
    </PageContainer>
  );
}
