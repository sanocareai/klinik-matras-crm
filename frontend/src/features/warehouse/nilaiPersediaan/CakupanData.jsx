import React from "react";
import {
  TEKS_DOKUMEN_BUKAN_BUKTI, chipPengecualian, kalimatCakupan, kalimatHarga, kalimatKuantitas, kalimatNolOwner, segmenCakupan,
} from "./nilaiPersediaanLogic.js";
import { kodeFilterSah, ringkasCakupanData } from "./nilaiTampilanLogic.js";

// "CAKUPAN DATA" — bagian ringkas yang dapat dibuka (elemen <details>: klik, keyboard, sentuh). Tiga cakupan TETAP terpisah dengan penyebut masing-masing:
//   nilai (dinilai / bahan relevan), kuantitas menurut ledger (diketahui di ledger / seluruh bahan), dan harga (punya Harga Berlaku / bahan bersaldo positif).
// Nol Owner, tanpa catatan stok, dan pengamatan satuan lain tidak digabung ke persentase mana pun. Angka utama bagian ini tetap terbaca di judul saat tertutup.
export default function CakupanData({ d, onFilter }) {
  const c = d.cakupan; const k = c.kuantitas; const h = c.harga; const sub = d.kartu.belumDinilai.perSubStatus;
  return (
    <details className="nip-bagian nip-cakupan" data-testid="np-cakupan">
      <summary><span className="nip-bagian-judul">Cakupan data</span><span className="nip-bagian-info" data-testid="np-cakupan-ringkas">{ringkasCakupanData(c)}</span></summary>
      <div className="nip-bagian-isi">
        <div className="nip-strip" role="img" aria-label={kalimatCakupan(c)}>{segmenCakupan(c).map((s) => <i key={s.status} className={`nip-seg nip-bg-${s.nada}`} style={{ width: `${s.persen}%` }} title={`${s.teks}: ${s.jumlah}`} />)}</div>
        <ul className="nip-legenda" aria-label="Jumlah bahan per status (ketuk untuk menyaring tabel)">
          {segmenCakupan(c).map((s) => (
            <li key={s.status}>{kodeFilterSah(s.status)
              ? <button type="button" className={`nip-pil-status nip-${s.nada}`} onClick={() => onFilter(s.status)} data-testid={`np-legenda-${s.status}`}><i className="nip-titik" />{s.teks} <b>{s.jumlah}</b></button>
              : <span className={`nip-pil-status nip-${s.nada}`}><i className="nip-titik" />{s.teks} <b>{s.jumlah}</b></span>}</li>
          ))}
        </ul>

        <dl className="nip-dl-cakupan">
          <div data-testid="np-cakupan-nilai"><dt>Nilai</dt><dd>{kalimatCakupan(c)}. Saldo nol sah: {c.saldoNol}. Seluruh {c.universe} bahan dalam laporan.</dd></div>
          {k && <div data-testid="np-cakupan-kuantitas"><dt>Kuantitas menurut ledger</dt><dd>{kalimatKuantitas(k).replace("Kuantitas menurut ledger: ", "")}.<span className="nip-kecil" data-testid="np-cakupan-nol-owner">{kalimatNolOwner(k)}</span></dd></div>}
          {h && <div data-testid="np-cakupan-harga"><dt>Harga</dt><dd>{kalimatHarga(h)}.<span className="nip-kecil">{TEKS_DOKUMEN_BUKAN_BUKTI}</span></dd></div>}
          <div data-testid="np-pecah"><dt>Belum bisa dinilai</dt>
            <dd>
              <span className="nip-chips">{chipPengecualian(d.kartu.belumDinilai).map((x) => <span key={x.kunci} className="nip-chip">{x.jumlah} {x.teks}</span>)}</span>
              {sub && <span className="nip-kecil" data-testid="np-k3-sub">Dari stok belum diketahui: <b>{sub.TANPA_CATATAN_STOK}</b> tanpa catatan stok dan tanpa hasil SO · <b>{sub.NOL_DIKONFIRMASI_OWNER}</b> fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count; belum di ledger (bukan saldo nol, tidak dinilai).</span>}
              {(c.pengecualianSatuanTerbuka > 0 || c.hasilSOKedaluwarsa > 0) && <span className="nip-kecil" data-testid="np-k3-so">{c.pengecualianSatuanTerbuka} pengecualian satuan masih terbuka · {c.hasilSOKedaluwarsa} catatan SO kedaluwarsa (ada pergerakan sesudah tanggal SO).</span>}
            </dd></div>
        </dl>
      </div>
    </details>
  );
}
