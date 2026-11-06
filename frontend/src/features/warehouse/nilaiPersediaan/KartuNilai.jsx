import React from "react";
import { Glif, Ubin } from "@/features/warehouse/beranda/IkonApple.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { TEKS_BELUM_FINAL } from "./nilaiPersediaanLogic.js";

// TIGA KARTU RINGKAS (gaya widget): Estimasi nilai stok · Saldo akun Finance · Perlu dilengkapi. Maksimal SATU kalimat pendukung per kartu; definisi panjang ada di ikon info (klik/keyboard/sentuh, bukan hover).
// Estimasi stok dan saldo Finance adalah dua angka berbeda dan TIDAK dijumlahkan atau dianggap identik. Nilai tidak diketahui tampil "—", bukan Rp0.
function Kartu({ kelas, glif, judul, testid, infoJudul, info, children }) {
  const t = useInfoToggle();
  return (
    <section className={`nip-k ${kelas}`} data-testid={testid} aria-label={judul}>
      <Glif nama={glif} size={104} className="nip-k-besar" />
      <header className="nip-k-kepala">
        <Ubin nada="kaca" nama={glif} ukuran={34} />
        <h2>{judul}</h2>
        <InfoToggleButton info={t} label={infoJudul ?? judul} className="nip-ibtn" />
      </header>
      <InfoToggleIsi info={t} className="nip-iisi">{info}</InfoToggleIsi>
      {children}
    </section>
  );
}

export default function KartuNilai({ d, ringkas, onRincianAkun, onLihatBahan }) {
  const { estimasi: e, finance: f, perlu: p } = ringkas;
  return (
    <div className="nip-kartu" data-testid="np-kartu">
      <Kartu kelas="nip-k-biru" glif="kotak" judul="Estimasi nilai stok" testid="np-k1" infoJudul="Cara menghitung estimasi nilai stok"
        info={<><p><b>Estimasi nilai stok.</b> {d.definisi.estimasi}</p><p><b>Berdasarkan ledger.</b> {d.definisi.ledger}</p><p><b>Tanpa hasil SO bermasalah.</b> {d.definisi.tanpaBermasalah}</p><p>{TEKS_BELUM_FINAL}</p></>}>
        <div className="nip-besar" data-testid="np-k1-nilai">{e.nilai}</div>
        <p className="nip-sublabel" data-testid="np-k1-label">Berdasarkan ledger (saldo × Harga Berlaku)</p>
        <p className="nip-pils">
          {e.parsial && <span className="nip-pil nip-pil-putih" data-testid="np-k1-parsial">Parsial</span>}
          <span className="nip-pil" data-testid="np-k1-status">{e.statusRekon}</span>
        </p>
        <div className="nip-inset" data-testid="np-k1-tanpa">
          <span>Setelah pengecualian hasil SO</span>
          <b>{e.setelahPengecualian}</b>
          <small>{e.bahanDikecualikan} bahan dikecualikan{e.nilaiDikecualikan ? ` (${e.nilaiDikecualikan})` : ""}</small>
        </div>
        <p className="nip-kalimat" data-testid="np-k1-dinilai">{e.kalimat}</p>
      </Kartu>

      <Kartu kelas="nip-k-ungu" glif="bank" judul="Saldo akun Finance" testid="np-k2" infoJudul="Arti saldo akun Finance"
        info={<><p><b>Saldo akun Finance.</b> {d.definisi.finance}</p><p>Saldo ini berasal dari jurnal pembukuan, bukan dari stok, dan tidak dialokasikan ke bahan. Bukan angka yang sama dengan estimasi nilai stok.</p></>}>
        <div className="nip-besar" data-testid="np-k2-nilai">{f.nilai}</div>
        <p className="nip-sublabel">Menurut pembukuan Finance</p>
        <p className="nip-pils"><span className="nip-pil" data-testid="np-k2-status">{f.status}</span></p>
        <p className="nip-kalimat" data-testid="np-k2-kalimat">{f.kalimat}</p>
        <button type="button" className="nip-kartu-tombol" onClick={onRincianAkun} data-testid="np-k2-rincian">Rincian akun <Glif nama="kanan" size={14} /></button>
      </Kartu>

      <Kartu kelas="nip-k-jingga" glif="opname" judul="Perlu dilengkapi" testid="np-k3" infoJudul="Arti perlu dilengkapi"
        info={<><p><b>Bahan relevan.</b> {d.definisi.relevan}</p><p>{d.kartu.belumDinilai.catatan} Tetap dihitung di cakupan, tidak disembunyikan.</p></>}>
        <div className="nip-besar" data-testid="np-k3-jumlah">{p.jumlah}</div>
        <p className="nip-sublabel">bahan unik</p>
        <p className="nip-kalimat" data-testid="np-k3-kalimat">{p.kalimat}</p>
        <button type="button" className="nip-kartu-tombol" onClick={onLihatBahan} data-testid="np-k3-lihat">Lihat bahan <Glif nama="kanan" size={14} /></button>
      </Kartu>
    </div>
  );
}
