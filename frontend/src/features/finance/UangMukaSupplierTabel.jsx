import React from "react";
import { formatUang } from "@/features/finance/shared.jsx";
import { KartuKpiApple } from "@/features/finance/DaftarGaya.jsx";
import { UbinApple } from "@/components/ikApple.jsx";

// "Uang Muka & Utang per Supplier" (tab Daftar supplier). Angka dari server (GET /finance/purchase-orders/uang-muka/ringkasan-supplier) — layar tidak menghitung ulang.
// Saldo bersih = utang aktif − uang muka belum diterapkan (negatif = supplier masih berutang barang kepada kita).
export function TabelUangMukaSupplier({ data }) {
  const daftar = data?.suppliers || [];
  if (!data || daftar.length === 0) return null;
  const k = data.kartu;
  const definisi = (kunci) => (data.definisi || []).find((d) => d.kunci === kunci)?.definisi;
  return (
    <div className="flex flex-col gap-4" data-testid="tabel-uang-muka-supplier">
      <section className="fin-kw-baris" data-kolom="3" aria-label="Ringkasan uang muka supplier" data-testid="kartu-uang-muka-supplier">
        <KartuKpiApple ikon="koin" warna="hijau" label="Uang muka belum diterapkan" nilai={formatUang(k.uangMukaBelumDiterapkan)} ket={definisi("uangMukaBelumDiterapkan") || "Sudah dibayar, belum mengurangi faktur mana pun (aset)"} />
        <KartuKpiApple ikon="dokumen" warna="ungu" label="Utang aktif" nilai={formatUang(k.utangAktif)} ket={definisi("utangAktif") || "Sisa utang faktur yang sudah disetujui"} />
        <KartuKpiApple ikon="uang" warna={k.saldoBersih < 0 ? "jingga" : "biru"} label="Saldo bersih" nilai={formatUang(k.saldoBersih)} ket={definisi("saldoBersih") || "Utang aktif dikurangi uang muka belum diterapkan"} />
      </section>
      <section className="fin-tg-panel" aria-label="Uang muka dan utang per supplier">
        <p className="fin-tg-jumlah">Uang muka &amp; utang per supplier · total uang muka {formatUang(k.totalUangMuka)}, sudah terpakai {formatUang(k.uangMukaTerpakai)}</p>
        <div className="fin-dl-tabel" role="table" aria-label="Uang muka dan utang per supplier" style={{ "--kolom-sedang": "minmax(220px, 2fr) 150px 150px 140px", "--kolom-lebar": "minmax(220px, 2fr) 140px 140px 150px 140px 140px" }}>
          <div className="fin-dl-judul" role="row">
            <span role="columnheader">Supplier</span><span role="columnheader" className="kanan fin-dl-lebar">Total uang muka</span><span role="columnheader" className="kanan fin-dl-lebar">Terpakai</span>
            <span role="columnheader" className="kanan">Belum diterapkan</span><span role="columnheader" className="kanan">Utang aktif</span><span role="columnheader" className="kanan" title="Utang aktif dikurangi uang muka belum diterapkan">Saldo bersih</span>
          </div>
          {daftar.map((s) => (
            <div key={s.supplierId} className="fin-dl-baris" role="row" style={{ cursor: "default" }}>
              <div className="fin-dl-sel fin-dl-utama" role="cell">
                <UbinApple nama="gedung" ukuran={40} />
                <span className="fin-dl-teks"><span className="fin-dl-judul-baris" title={s.supplier}>{s.supplier}</span>{s.kode && <span className="fin-dl-nomor">{s.kode}</span>}</span>
              </div>
              <div className="fin-dl-sel fin-dl-angka fin-dl-lebar" role="cell"><span className="fin-dl-label">Total uang muka</span>{formatUang(s.totalUangMuka)}</div>
              <div className="fin-dl-sel fin-dl-angka fin-dl-lebar" role="cell"><span className="fin-dl-label">Terpakai</span>{formatUang(s.uangMukaTerpakai)}</div>
              <div className="fin-dl-sel fin-dl-angka" role="cell"><span className="fin-dl-label">Belum diterapkan</span><span className={s.uangMukaBelumDiterapkan > 0 ? "fin-dl-sub jingga" : undefined} style={s.uangMukaBelumDiterapkan > 0 ? { fontWeight: 600, fontSize: 14 } : undefined}>{formatUang(s.uangMukaBelumDiterapkan)}</span></div>
              <div className="fin-dl-sel fin-dl-angka" role="cell"><span className="fin-dl-label">Utang aktif</span>{formatUang(s.utangAktif)}</div>
              <div className="fin-dl-sel fin-dl-angka" role="cell"><span className="fin-dl-label">Saldo bersih</span><span className={s.saldoBersih < 0 ? "fin-dl-sub jingga" : undefined} style={s.saldoBersih < 0 ? { fontWeight: 600, fontSize: 14 } : undefined}>{formatUang(s.saldoBersih)}</span></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
