import React, { useId, useState } from "react";
import { X } from "lucide-react";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { Button } from "@/components/ui/button.jsx";
import { DASAR_PERIODE_TEKS, HUBUNGAN_FILTER_TEKS, KELENGKAPAN_BUKAN, KELENGKAPAN_FILTER, POSISI_FILTER, TARGET_FILTER, opsiPic, toggleKelengkapan } from "@/features/production/orderProduksiModel.js";

// Isi popover "Filter" (desktop) dan lembar filter (HP): kelompok Posisi unit · PIC · Target selesai · Kelengkapan (+ Status order / Status kerja bila toolbar menyempit).
// Memakai STATE SEMENTARA (draf): pilihan baru berlaku hanya saat "Terapkan"; "Batal"/menutup membuang draf tanpa mengubah filter aktif.
// "Reset semua filter" memakai definisi yang SAMA dengan Reset di baris chip (semua filter daftar kembali ke bawaan; antrean Aktif/Riwayat/Semua tidak berubah) dan berlaku langsung.
// Semua nilai disaring di SERVER atas seluruh hasil; panel ini tidak menulis apa pun.
function Cek({ tipe = "checkbox", nama, checked, onChange, jumlah, testid, children }) {
  return (
    <label className={"prod-fl-cek" + (checked ? " aktif" : "")}>
      <input type={tipe} name={nama} checked={checked} onChange={onChange} data-testid={testid} />
      <span className="prod-fl-cek-teks">{children}</span>
      {jumlah != null && <span className="prod-fl-n" aria-label={`${jumlah} unit`}>{jumlah}</span>}
    </label>
  );
}

export default function FilterLainnya({ nilai, tabsShown = [], opsiKerja = [], sempit = false, hitung, memuat, scope, onLihatRiwayat, onTerapkan, onBatal, onResetSemua, adaFilter, tanpaKepala = false, judulId }) {
  const [draf, setDraf] = useState(() => ({ tab: nilai.tab || "", kerja: nilai.kerja || "", posisi: [...nilai.posisi], pic: nilai.pic || "", target: nilai.target || "", kelengkapan: [...nilai.kelengkapan] }));
  const info = useInfoToggle(); const infoKel = useInfoToggle(); const idPic = useId(); const idTab = useId(); const idKerja = useId();
  const set = (k, v) => setDraf((d) => ({ ...d, [k]: v }));
  const adaPerubahan = JSON.stringify(draf) !== JSON.stringify({ tab: nilai.tab || "", kerja: nilai.kerja || "", posisi: nilai.posisi, pic: nilai.pic || "", target: nilai.target || "", kelengkapan: nilai.kelengkapan });
  const belumDinilai = hitung?.dataOrder?.belumDinilai ?? 0;
  const adaRiwayat = scope !== "riwayat" && !!onLihatRiwayat && (hitung?.riwayat?.unik ?? 0) > 0;
  return (
    <div className="prod-fl" data-testid="filter-lainnya-isi" role="group" aria-labelledby={judulId}>
      {!tanpaKepala && (
        <div className="prod-fl-kepala">
          <h3 id={judulId} className="prod-fl-judul-utama">Filter</h3>
          <InfoToggleButton info={info} label="Cara filter digabung" />
          <button type="button" className="prod-fl-tutup" aria-label="Tutup filter tanpa menerapkan" data-testid="filter-tutup" onClick={onBatal}><X size={18} aria-hidden /></button>
        </div>
      )}
      {tanpaKepala && <div className="prod-fl-hubungan-baris"><InfoToggleButton info={info} label="Cara filter digabung" /><span className="prod-fl-bantu">Cara filter digabung</span></div>}
      <InfoToggleIsi info={info}><p className="m-0" data-testid="filter-hubungan">{HUBUNGAN_FILTER_TEKS}</p></InfoToggleIsi>

      <div className="prod-fl-gulir" data-testid="filter-gulir">
        {sempit && (
          <section className="prod-fl-bagian" aria-label="Status">
            <div className="prod-fl-dua">
              <div className="prod-fl-medan"><label htmlFor={idTab} className="prod-fl-judul">Status order</label>
                <select id={idTab} value={draf.tab} onChange={(e) => set("tab", e.target.value)} data-testid="draf-status-order">
                  <option value="">Semua status order</option>{tabsShown.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select></div>
              <div className="prod-fl-medan"><label htmlFor={idKerja} className="prod-fl-judul">Status kerja</label>
                <select id={idKerja} value={draf.kerja} onChange={(e) => set("kerja", e.target.value)} data-testid="draf-status-kerja">
                  <option value="">Semua status kerja</option>{opsiKerja.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select></div>
            </div>
          </section>
        )}

        <div className="prod-fl-kolom">
          <section className="prod-fl-bagian" aria-labelledby="fl-posisi">
            <h4 id="fl-posisi" className="prod-fl-judul">Posisi unit</h4>
            <p className="prod-fl-bantu">Di mana unit fisik sekarang menurut dokumen jemput, terima, dan kirim — bukan status order. Boleh lebih dari satu (salah satu cocok).</p>
            <div className="prod-fl-daftar" role="group" aria-labelledby="fl-posisi">
              {POSISI_FILTER.map((p) => <Cek key={p.key} checked={draf.posisi.includes(p.key)} testid={`posisi-${p.key}`} onChange={() => set("posisi", draf.posisi.includes(p.key) ? draf.posisi.filter((k) => k !== p.key) : [...draf.posisi, p.key])}>{p.label}</Cek>)}
            </div>
          </section>

          <div className="prod-fl-kolom-kanan">
            <section className="prod-fl-bagian">
              <label htmlFor={idPic} className="prod-fl-judul">PIC</label>
              <select id={idPic} value={draf.pic} onChange={(e) => set("pic", e.target.value)} data-testid="draf-pic" aria-label="Saring PIC">
                <option value="">Semua PIC</option>{opsiPic(hitung, draf.pic).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="prod-fl-bantu">PIC dari tahap kerja atau rencana. “Belum ditugaskan” = unit tanpa PIC{memuat ? " (menghitung…)" : ""}.</p>
            </section>

            <section className="prod-fl-bagian" aria-labelledby="fl-target">
              <h4 id="fl-target" className="prod-fl-judul">Target selesai</h4>
              <div className="prod-fl-daftar" role="radiogroup" aria-labelledby="fl-target">
                <Cek tipe="radio" nama="fl-target" checked={!draf.target} testid="target-semua" onChange={() => set("target", "")}>Semua target</Cek>
                {TARGET_FILTER.map((t) => <Cek key={t.key} tipe="radio" nama="fl-target" checked={draf.target === t.key} testid={`target-${t.key}`} onChange={() => set("target", t.key)}>{t.label}</Cek>)}
              </div>
              <p className="prod-fl-bantu">Hari dihitung menurut WIB. Berbeda dari periode order masuk di baris atas.</p>
            </section>
          </div>
        </div>

        <section className="prod-fl-bagian prod-fl-kel" aria-labelledby="fl-kel" data-testid="kelengkapan-filter">
          <div className="prod-fl-kel-kepala">
            <h4 id="fl-kel" className="prod-fl-judul">Kelengkapan data</h4>
            <InfoToggleButton info={infoKel} label="Cara menghitung kelengkapan" />
            <span className="prod-fl-bantu prod-fl-kanan" data-testid="kel-unik">{hitung ? `${hitung.unik} unit berkekurangan` : memuat ? "Menghitung…" : ""}</span>
          </div>
          <InfoToggleIsi info={infoKel}>
            <p className="m-0">Jumlah dihitung server atas seluruh unit yang cocok dengan filter aktif. “Unit berkekurangan” menghitung unit unik; satu unit boleh masuk beberapa kategori, jadi angka kategori tidak dijumlahkan.</p>
            <p className="m-0">{KELENGKAPAN_BUKAN}</p>
            <p className="m-0">HPP = HPP operasional (harga berlaku Gudang), bukan biaya Finance.</p>
            <p className="m-0" data-testid="dasar-periode">Periode di baris filter memakai: {DASAR_PERIODE_TEKS}. Hari dihitung menurut WIB dan tanggal akhir ikut penuh; “Semua waktu” = tanpa batas tanggal.</p>
          </InfoToggleIsi>
          <div className="prod-fl-daftar dua" role="group" aria-labelledby="fl-kel">
            {KELENGKAPAN_FILTER.map((k) => <Cek key={k.key} checked={draf.kelengkapan.includes(k.key)} jumlah={memuat && hitung?.counts?.[k.key] === undefined ? "…" : hitung?.counts?.[k.key] ?? 0} testid={`kel-${k.key}`} onChange={() => set("kelengkapan", toggleKelengkapan(draf.kelengkapan, k.key))}>{k.label}</Cek>)}
          </div>
          <p className="prod-fl-bantu" data-testid="kel-tumpang">Pilihan lebih dari satu berarti salah satu cocok.</p>
          {belumDinilai > 0 && <p className="prod-fl-bantu belum" data-testid="kel-belum-dinilai"><b>{belumDinilai} unit belum dinilai</b> — order biasa belum punya aturan kelengkapan wajib. Ini bukan “lengkap” dan tidak dihitung sebagai kekurangan.</p>}
          {adaRiwayat && <p className="prod-fl-bantu" data-testid="kel-riwayat">{hitung.riwayat.unik} unit Terkirim juga berkekurangan. <button type="button" className="prod-tautan" data-testid="kel-lihat-riwayat" onClick={onLihatRiwayat}>Lihat di Riwayat</button></p>}
        </section>
      </div>

      <div className="prod-fl-kaki">
        <Button variant="ghost" size="sm" className="prod-fl-reset" data-testid="filter-reset-semua" onClick={onResetSemua} disabled={!adaFilter}>Reset semua filter</Button>
        <span className="prod-fl-kaki-aksi">
          <Button variant="secondary" size="sm" data-testid="filter-batal" onClick={onBatal}>Batal</Button>
          <Button variant="primary" size="sm" data-testid="filter-terapkan" onClick={() => onTerapkan(draf)} disabled={!adaPerubahan}>Terapkan</Button>
        </span>
      </div>
    </div>
  );
}
