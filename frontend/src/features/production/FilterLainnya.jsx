import React from "react";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import KelengkapanFilter from "@/features/production/KelengkapanFilter.jsx";
import { HUBUNGAN_FILTER_TEKS, POSISI_FILTER, TARGET_FILTER, opsiPic } from "@/features/production/orderProduksiModel.js";

// Isi panel "Filter lainnya" (inline di desktop, lembar samping di HP): Posisi unit · PIC · Target selesai · Kelengkapan.
// Semua nilai disaring di SERVER atas seluruh hasil; panel ini hanya mengatur pilihan. Tidak menulis apa pun.
export default function FilterLainnya({ posisi, onTogglePosisi, pic, onPic, target, onTarget, hitung, memuat, kelengkapan, onToggleKelengkapan, onBersihKelengkapan, scope, onLihatRiwayat }) {
  const info = useInfoToggle();
  return (
    <div className="prod-fl" data-testid="filter-lainnya-isi">
      <section className="prod-fl-bagian" aria-labelledby="fl-posisi">
        <h3 id="fl-posisi" className="prod-fl-judul">Posisi unit</h3>
        <p className="prod-fl-bantu">Di mana unit fisik sekarang menurut dokumen jemput, terima, dan kirim — bukan status order.</p>
        <div className="prod-kel-chips" role="group" aria-labelledby="fl-posisi">
          {POSISI_FILTER.map((p) => {
            const on = posisi.includes(p.key);
            return <button key={p.key} type="button" aria-pressed={on} data-testid={`posisi-${p.key}`} onClick={() => onTogglePosisi(p.key)} className={cn("prod-chip", on && "aktif")}>{p.label}</button>;
          })}
        </div>
      </section>

      <div className="prod-fl-dua">
        <section className="prod-fl-bagian" aria-labelledby="fl-pic">
          <h3 id="fl-pic" className="prod-fl-judul">PIC</h3>
          <FilterDropdown value={pic} onChange={onPic} options={opsiPic(hitung, pic)} placeholder="Semua PIC" ariaLabel="Saring PIC" triggerClassName="prod-filter-pemicu prod-fl-pemicu" />
          <p className="prod-fl-bantu">PIC dari tahap kerja atau rencana. “Belum ditugaskan” = unit tanpa PIC{memuat ? " (menghitung…)" : ""}.</p>
        </section>
        <section className="prod-fl-bagian" aria-labelledby="fl-target">
          <h3 id="fl-target" className="prod-fl-judul">Target selesai</h3>
          <div className="prod-kel-chips" role="group" aria-labelledby="fl-target">
            {TARGET_FILTER.map((t) => {
              const on = target === t.key;
              return <button key={t.key} type="button" aria-pressed={on} title={t.bantu} data-testid={`target-${t.key}`} onClick={() => onTarget(on ? "" : t.key)} className={cn("prod-chip", on && "aktif")}>{t.label}</button>;
            })}
          </div>
          <p className="prod-fl-bantu">Hari dihitung menurut WIB. Berbeda dari periode order masuk di baris atas.</p>
        </section>
      </div>

      <KelengkapanFilter hitung={hitung} memuat={memuat} terpilih={kelengkapan} onToggle={onToggleKelengkapan} onBersih={onBersihKelengkapan} scope={scope} onLihatRiwayat={onLihatRiwayat} />

      <div className="prod-fl-hubungan">
        <InfoToggleButton info={info} label="Cara filter digabung" />
        <span className="prod-fl-bantu" data-testid="filter-hubungan-ringkas">Filter digabung dengan DAN; pilihan ganda dalam satu kelompok dengan ATAU.</span>
        <InfoToggleIsi info={info}><p className="m-0" data-testid="filter-hubungan">{HUBUNGAN_FILTER_TEKS}</p></InfoToggleIsi>
      </div>
    </div>
  );
}
