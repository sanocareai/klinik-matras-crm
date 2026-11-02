import React from "react";
import DatePicker from "@/components/ui/date-picker.jsx";

// Kolom tanggal Produksi — memakai pemilih tanggal APLIKASI (components/ui/date-picker.jsx; tampilan "2 Nov 2026", kalender WIB) sebagai pengganti
// <input type="date"> bawaan peramban yang tampil tak konsisten. Nilai tetap string "YYYY-MM-DD" ("" = kosong); `onChange` menerima nilai langsung (bukan event).
// `data-testid`/`aria-label`/`id` diteruskan ke tombol pemicu supaya pencarian elemen (tes & pembaca layar) tetap sama.
export default function TanggalField({ value, onChange, min, disabled, placeholder = "Pilih tanggal", clearLabel = "Kosongkan tanggal", className, id, "data-testid": testId, "aria-label": ariaLabel }) {
  return (
    <DatePicker
      block
      value={value || ""}
      onChange={onChange}
      minDate={min || undefined}
      disabled={disabled}
      placeholder={placeholder}
      clearLabel={clearLabel}
      className={className}
      triggerClassName="prod-tanggal"
      triggerProps={{ ...(id ? { id } : {}), ...(testId ? { "data-testid": testId } : {}), ...(ariaLabel ? { "aria-label": ariaLabel } : {}) }}
    />
  );
}
