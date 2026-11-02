import React from "react";
import { X } from "lucide-react";

// Baris hasil + filter aktif: jumlah hasil (dari server) terpisah dari kontrol, setiap filter aktif jadi chip yang bisa dihapus, dan satu tombol Reset.
// Reset hanya mengembalikan filter daftar ke bawaan; antrean Aktif/Riwayat/Semua tidak berubah (bukan filter).
export default function ChipFilterAktif({ chip, onHapus, onReset, jumlah }) {
  return (
    <div className="prod-ol-aktif" data-testid="filter-aktif-baris">
      <p className="prod-ol-hasil" data-testid="hasil-jumlah" aria-live="polite">{jumlah}</p>
      {chip.length > 0 && (
        <ul className="prod-ol-chip-daftar" aria-label="Filter aktif" data-testid="filter-aktif">
          {chip.map((c) => (
            <li key={c.id}>
              <span className="prod-ol-chip-aktif" data-testid="filter-chip" data-kelompok={c.kelompok}>
                <span>{c.label}</span>
                <button type="button" className="prod-ol-chip-x" aria-label={`Hapus filter ${c.label}`} data-testid="filter-chip-hapus" onClick={() => onHapus(c)}><X size={14} aria-hidden /></button>
              </span>
            </li>
          ))}
          <li><button type="button" className="prod-ol-hapus" data-testid="reset-filter" onClick={onReset}>Reset filter</button></li>
        </ul>
      )}
    </div>
  );
}
