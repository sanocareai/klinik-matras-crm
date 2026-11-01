import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, ListOrdered, Search, Filter, X, Info } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { api } from "@/api.js";
import { tanggalPendek, tanggalJam, Pilihan } from "@/features/finance/shared.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { useTertunda } from "@/features/finance/FilterBar.jsx";
import { klikBuka } from "@/features/finance/PanelDetail.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { OPSI_ARAH, OPSI_URUT, OPSI_COCOK_BUKU, paramSaring, hariIniWib, angkaSaring } from "@/features/finance/rekonBankLogic.js";
import { IkMasuk, IkKeluar, IkSaldo } from "@/components/financeIconsKasBank.jsx";
import { tampilUang, RincianKb, ChipKs } from "@/features/finance/kasbank/KasBankPanels.jsx";
import { kalimatMutasi, catatanPosisiMutasi, pencocokanBaris, LABEL_STATUS_JURNAL } from "@/features/finance/kasbank/kasBankTampilan.js";

// MUTASI BUKU per rekening (menurut JURNAL, bukan menurut bank). Semua angka (saldo awal, masuk, keluar, saldo berjalan, saldo akhir) dari server
// (GET /finance/buku/rekening/:id/mutasi — satu sumber dengan Export Excel); di sini tidak ada penjumlahan atau perhitungan ulang saldo.

const BATAS = 100;
const propBaris = (buka) => { const { clickable, ...sisa } = klikBuka(buka); return sisa; };

function Persamaan({ data, periode, catatan }) {
  const jumlah = (n, nol) => (n ? `${Number(n).toLocaleString("id-ID")} transaksi` : nol);
  return (
    <section className="fin-ks-persamaan" aria-label="Ringkasan mutasi periode">
      <div className="fin-ks-pers-baris">
        <div className="fin-ks-pers-ubin fin-ks-pers-awal">
          <span className="fin-ks-pers-ikon" aria-hidden="true"><IkSaldo size={22} /></span>
          <div><p className="fin-ks-pers-label">Saldo awal</p><p className="fin-ks-pers-nilai">{tampilUang(data?.saldoAwal)}</p><p className="fin-ks-pers-ket">per {tanggalPendek(periode.from)}</p></div>
        </div>
        <span className="fin-ks-op" aria-hidden="true">+</span>
        <div className="fin-ks-pers-ubin fin-ks-pers-masuk">
          <span className="fin-ks-pers-ikon" aria-hidden="true"><IkMasuk size={22} /></span>
          <div><p className="fin-ks-pers-label">Uang masuk</p><p className="fin-ks-pers-nilai">{tampilUang(data?.totalMasuk)}</p><p className="fin-ks-pers-ket">{jumlah(data?.jumlahMasuk, "tidak ada transaksi")}</p></div>
        </div>
        <span className="fin-ks-op" aria-hidden="true">−</span>
        <div className="fin-ks-pers-ubin fin-ks-pers-keluar">
          <span className="fin-ks-pers-ikon" aria-hidden="true"><IkKeluar size={22} /></span>
          <div><p className="fin-ks-pers-label">Uang keluar</p><p className="fin-ks-pers-nilai">{tampilUang(data?.totalKeluar)}</p><p className="fin-ks-pers-ket">{jumlah(data?.jumlahKeluar, "tidak ada transaksi")}</p></div>
        </div>
        <span className="fin-ks-op" aria-hidden="true">=</span>
        <div className="fin-ks-pers-ubin fin-ks-pers-akhir">
          <span className="fin-ks-pers-ikon" aria-hidden="true"><IkSaldo size={22} /></span>
          <div><p className="fin-ks-pers-label">Saldo akhir</p><p className="fin-ks-pers-nilai">{tampilUang(data?.saldoAkhir)}</p><p className="fin-ks-pers-ket">per {tanggalPendek(periode.to)}</p></div>
        </div>
      </div>
      <p className="fin-ks-pers-dasar">Pergerakan rekening menurut pembukuan (bukan menurut bank). Uang masuk bukan otomatis pendapatan, dan uang keluar bukan otomatis biaya usaha.
        {data?.paritas ? (data.paritas.cocok ? " Saldo akhir sama dengan saldo kartu rekening pada tanggal yang sama." : ` Saldo akhir BERBEDA dari saldo kartu rekening pada tanggal yang sama (${tampilUang(data.paritas.saldoKartu)}).`) : ""}
        {catatan ? ` ${catatan}` : ""}</p>
    </section>
  );
}

function PeringatanData({ daftar }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  if (!daftar?.length) return null;
  return (
    <section className="fin-ks-peringatan" role="note">
      <div className="fin-ks-peringatan-baris">
        <AlertTriangle size={20} aria-hidden="true" className="fin-ks-peringatan-ikon" />
        <div className="fin-ks-peringatan-teks">
          <p className="fin-ks-peringatan-judul">{daftar.length === 1 ? `${Number(daftar[0].jumlahBaris).toLocaleString("id-ID")} baris jurnal tidak masuk mutasi ini` : `${daftar.length} catatan data pada rekening ini`}</p>
          <p className="fin-ks-peringatan-isi">Saldo di atas tetap dihitung server dengan aturan yang sama.</p>
        </div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-ks-peringatan-btn">Lihat rincian</Pembuka>
      </div>
      {buka && <div id={id} className="fin-ks-peringatan-lengkap">{daftar.map((p) => <p key={p.kode} data-testid={`peringatan-${p.kode}`}>{p.pesan}</p>)}</div>}
    </section>
  );
}

function BarisMutasi({ b, onBuka }) {
  const masuk = !!b.masuk;
  const pc = pencocokanBaris(b);
  return (
    <li className="fin-ks-baris" data-arah={masuk ? "masuk" : "keluar"} data-testid="baris-mutasi" {...propBaris(() => onBuka(b))}>
      <div className="fin-ks-b-tgl"><span className="fin-ks-label-kecil">Tanggal buku</span>{tanggalPendek(b.tanggalBuku ?? b.tanggal)}</div>
      <div className="fin-ks-b-ket">
        <span className="fin-ks-b-nama" title={b.keterangan}>{b.keterangan}</span>
        <span className="fin-ks-b-nomor">{b.nomor}{b.sumberLabel ? ` · ${b.sumberLabel}` : ""}</span>
        {b.lawan && <span className="fin-ks-sekunder" title={b.lawan}>{b.lawan}</span>}
      </div>
      <div className="fin-ks-b-masuk"><span className="fin-ks-label-kecil">Masuk</span>{b.masuk ? <span className="fin-ks-nilai-masuk">{tampilUang(b.masuk)}</span> : <span className="fin-ks-redup">—</span>}</div>
      <div className="fin-ks-b-keluar"><span className="fin-ks-label-kecil">Keluar</span>{b.keluar ? <span className="fin-ks-nilai-keluar">{tampilUang(b.keluar)}</span> : <span className="fin-ks-redup">—</span>}</div>
      <div className="fin-ks-b-saldo"><span className="fin-ks-label-kecil">Saldo</span><span className="fin-ks-nilai">{tampilUang(b.saldo)}</span></div>
      <div className="fin-ks-b-cocok"><span className="fin-ks-label-kecil">Pencocokan</span><ChipKs nada={pc.nada}>{pc.label}</ChipKs></div>
      <div className="fin-ks-b-aksi" data-tanpa-detail>
        <button type="button" className="fin-ks-ikon-btn" onClick={() => onBuka(b)} aria-label={`Buka rincian ${b.nomor}`} title="Buka rincian"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
    </li>
  );
}

function specMutasi(b, rek) {
  const masuk = !!b.masuk;
  const pc = pencocokanBaris(b);
  const status = LABEL_STATUS_JURNAL[b.status] || b.status;
  return {
    judul: b.nomor, sub: `${masuk ? "Uang masuk ke" : "Uang keluar dari"} ${rek.name}`, chip: { label: status, nada: b.status === "REVERSED" ? "netral" : "hijau" },
    ringkas: [[masuk ? "Uang masuk" : "Uang keluar", tampilUang(b.masuk || b.keluar), masuk ? "hijau" : "oranye"], ["Saldo setelah transaksi", tampilUang(b.saldo)]],
    bagian: [
      { judul: "Transaksi", baris: [["Keterangan", b.keterangan], ["Akun lawan", b.lawan], ["Sumber dokumen", b.sumberLabel], ["Nomor dokumen", b.dokumen?.nomor], ["Nomor jurnal", b.nomor], ["Status jurnal", status], ["Membalik jurnal", b.membalik]] },
      { judul: "Tanggal & pencatat", baris: [["Tanggal buku", tanggalPendek(b.tanggalBuku ?? b.tanggal)], ["Dibuat pada", b.dibuatPada ? tanggalJam(b.dibuatPada) : null], ["Dibuat oleh", b.aktor], ["Diinput setelah tanggal bukunya", b.dibuatSetelahTanggalBuku ? "Ya (jurnal mundur)" : null], ["Tanggal bank", b.tanggalBank ? tanggalPendek(b.tanggalBank) : null], ["Tanggal efektif", b.tanggalEfektif ? tanggalPendek(b.tanggalEfektif) : null]] },
      { judul: "Pencocokan bank", baris: [["Status", pc.label]] },
    ],
    catatan: [
      { teks: "Tanggal buku (di jurnal), waktu dibuat, tanggal bank, dan tanggal efektif adalah empat hal berbeda. Tanggal bank dan efektif hanya ada bila baris ini sudah dipasangkan dengan rekening koran." },
      ...(b.status === "REVERSED" ? [{ teks: "Jurnal ini sudah dibalik; jurnal pembaliknya tampil sebagai baris sendiri bila jatuh dalam periode yang sama.", nada: "peringatan" }] : []),
    ],
  };
}

export default function MutasiBukuKb({ rek, periode }) {
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const [arah, setArah] = useState("");
  const [urut, setUrut] = useState("");
  const [sumber, setSumber] = useState("");
  const [cocok, setCocok] = useState("");
  const [min, setMin] = useState("");
  const [maks, setMaks] = useState("");
  const [lain, setLain] = useState(false);
  const idLain = useId();
  const saring = paramSaring({ arah, urut, min, maks, sumber, cocok });
  const kunciSaring = JSON.stringify(saring);
  const [hal, setHal] = useState(1);
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [rincian, setRincian] = useState(null);
  const permintaan = useRef(0);

  useEffect(() => { setHal(1); }, [rek.id, qTunda, periode.from, periode.to, kunciSaring]);
  // Ganti rekening: data rekening sebelumnya tidak boleh tampil di bawah judul rekening baru.
  useEffect(() => { setData(null); setRincian(null); }, [rek.id]);

  const muat = useCallback(async () => {
    const no = ++permintaan.current;
    setMemuat(true); setGalat(null);
    try {
      const d = await api.getMutasiRekening(rek.id, { from: periode.from, to: periode.to, q: qTunda.trim(), page: hal, limit: BATAS, ...saring });
      if (no === permintaan.current) setData(d);
    } catch (e) {
      if (no === permintaan.current) setGalat(e.message || "Gagal memuat mutasi rekening");
    } finally {
      if (no === permintaan.current) setMemuat(false);
    }
  }, [rek.id, periode.from, periode.to, qTunda, hal, kunciSaring]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { muat(); }, [muat]);

  const dataIni = data && (!data.rekening || data.rekening.id === rek.id) ? data : null;
  const baris = dataIni?.baris || [];
  const hasil = kalimatMutasi({ total: dataIni?.total, jumlahMutasi: dataIni?.jumlahMutasi, disaring: dataIni?.disaring });
  const catatanPosisi = catatanPosisiMutasi({ periodeTo: periode.to, hariIni: hariIniWib() });
  const adaFilter = !!(arah || urut || sumber || cocok || angkaSaring(min) || angkaSaring(maks) || q.trim());
  const nominalSalah = angkaSaring(min) && angkaSaring(maks) && Number(angkaSaring(min)) > Number(angkaSaring(maks));
  const lainAktif = [urut === "" ? "" : "x", angkaSaring(min), angkaSaring(maks)].filter(Boolean).length;
  const reset = () => { setQ(""); setArah(""); setUrut(""); setSumber(""); setCocok(""); setMin(""); setMaks(""); };

  return (
    <div className="fin-ks-mutasi">
      {galat && <div className="fin-ks-pesan" role="alert"><p>{galat}</p><button type="button" className="fin-tombol" onClick={muat}><span>Coba lagi</span></button></div>}

      <Persamaan data={dataIni} periode={periode} catatan={catatanPosisi} />
      <PeringatanData daftar={dataIni?.peringatan} />

      <section className="fin-panel fin-ks-panel" aria-label="Daftar mutasi buku" data-testid="panel-mutasi-buku">
        <div className="fin-ks-panel-kepala">
          <div className="fin-ks-panel-judul">
            <h2>Mutasi {rek.name}</h2>
            <p>Urut tanggal buku; tiap baris menunjukkan saldo setelah transaksi itu. Jurnal pembatalan tampil sebagai baris sendiri.</p>
          </div>
          <TombolExportExcel
            modul="mutasi-rekening" disabled={!dataIni}
            ambilBody={() => ({
              periode: { from: periode.from, to: periode.to },
              filter: { cashAccountId: rek.id, q: qTunda.trim(), ...saring },
              filterLabel: labelFilterAktif([["Rekening", rek.name], ["Pencarian", qTunda.trim()], ["Arah", OPSI_ARAH.find(([k]) => k === arah)?.[1]], ["Cocok bank", OPSI_COCOK_BUKU.find(([k]) => k === cocok)?.[1]], ["Sumber", (dataIni?.sumberTersedia || []).find((s) => s.kode === sumber)?.label], ["Urutan", OPSI_URUT.find(([k]) => k === urut)?.[1]], ["Nominal", saring.nominalMin || saring.nominalMaks ? `${saring.nominalMin || "0"} – ${saring.nominalMaks || "∞"}` : ""]]),
            })}
          />
        </div>
        <div className="fin-ks-toolbar">
          <div className="fin-ks-cari-baris">
            <label className="fin-ks-cari">
              <Search size={17} aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari jurnal, keterangan, atau nominal…" aria-label="Cari mutasi" />
            </label>
            <Pilihan value={arah} onChange={setArah} aria-label="Arah" className="fin-ks-pilih"><option value="">Arah</option>{OPSI_ARAH.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Pilihan>
            <Pilihan value={sumber} onChange={setSumber} aria-label="Sumber" className="fin-ks-pilih"><option value="">Sumber</option>{(dataIni?.sumberTersedia || []).map((s) => <option key={s.kode} value={s.kode}>{s.label}</option>)}</Pilihan>
            <Pilihan value={cocok} onChange={setCocok} aria-label="Status pencocokan" className="fin-ks-pilih"><option value="">Pencocokan</option>{OPSI_COCOK_BUKU.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Pilihan>
            <Pilihan value={urut} onChange={setUrut} aria-label="Urutan" className="fin-ks-pilih"><option value="">Urutan</option>{OPSI_URUT.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Pilihan>
            <Pembuka buka={lain} onToggle={() => setLain((v) => !v)} id={idLain} className="fin-pill fin-ks-lain" ikonKiri={<Filter size={16} aria-hidden="true" />}>
              Filter lainnya{(angkaSaring(min) || angkaSaring(maks)) && <span className="fin-lencana" aria-label="Filter nominal aktif">1</span>}
            </Pembuka>
          </div>
          {lain && (
            <div id={idLain} className="fin-ks-lain-isi">
              <label className="fin-ks-isian"><span>Nominal minimum (Rp)</span><input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="mis. 1.000.000" aria-label="Nominal minimum" /></label>
              <label className="fin-ks-isian"><span>Nominal maksimum (Rp)</span><input inputMode="decimal" value={maks} onChange={(e) => setMaks(e.target.value)} placeholder="mis. 5.000.000" aria-label="Nominal maksimum" /></label>
              {nominalSalah && <p role="alert" className="fin-ks-salah">Minimum lebih besar dari maksimum</p>}
            </div>
          )}
          <div className="fin-ks-hasil">
            <p className="fin-ks-hasil-teks" aria-live="polite">{memuat && !dataIni ? "Memuat mutasi…" : hasil.teks}{dataIni?.disaring && dataIni?.tersaring ? ` · tampil: masuk ${tampilUang(dataIni.tersaring.masuk)}, keluar ${tampilUang(dataIni.tersaring.keluar)}` : ""}</p>
            {adaFilter && <button type="button" className="fin-tombol" onClick={reset}><X size={15} aria-hidden="true" /><span>Atur ulang filter</span></button>}
          </div>
          {hasil.catatSaldo && <p className="fin-ks-catatan"><Info size={14} aria-hidden="true" /> {hasil.catatSaldo}</p>}
        </div>

        {memuat && !dataIni ? (
          <div className="fin-ks-kosong"><p className="fin-ks-memuat">Memuat mutasi…</p></div>
        ) : baris.length === 0 && !memuat ? (
          <div className="fin-ks-kosong"><EmptyState icon={ListOrdered} title={adaFilter ? "Tidak ada hasil" : "Tidak ada mutasi"} description={adaFilter ? "Tidak ada mutasi yang cocok dengan pencarian atau filter ini." : "Tidak ada transaksi pada rekening ini untuk periode ini."} action={adaFilter ? <button type="button" className="fin-tombol" onClick={reset}><span>Atur ulang filter</span></button> : null} /></div>
        ) : (
          <div className="fin-ks-daftar">
            <div className="fin-ks-kepala" aria-hidden="true">
              <span>Tanggal buku</span><span>Keterangan / dokumen</span><span className="fin-kanan">Masuk</span><span className="fin-kanan">Keluar</span><span className="fin-kanan">Saldo</span><span>Pencocokan</span><span className="fin-kanan">Rincian</span>
            </div>
            <ul className="fin-ks-baris-daftar" aria-label="Daftar mutasi buku" aria-busy={memuat}>
              {baris.map((b) => <BarisMutasi key={b.lineId} b={b} onBuka={(x) => setRincian(specMutasi(x, rek))} />)}
            </ul>
            {(hal > 1 || dataIni?.adaLagi) && (
              <div className="fin-ks-halaman">
                <span>Halaman {hal} · {BATAS} baris per halaman</span>
                <span className="fin-ks-halaman-tombol">
                  <button type="button" className="fin-tombol" disabled={hal <= 1 || memuat} onClick={() => setHal((h) => Math.max(1, h - 1))}><span>Sebelumnya</span></button>
                  <button type="button" className="fin-tombol" disabled={!dataIni?.adaLagi || memuat} onClick={() => setHal((h) => h + 1)}><span>Berikutnya</span></button>
                </span>
              </div>
            )}
          </div>
        )}
      </section>
      <RincianKb spec={rincian} onClose={() => setRincian(null)} />
    </div>
  );
}
