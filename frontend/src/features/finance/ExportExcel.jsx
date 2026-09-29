import React, { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button.jsx";
import { api } from "@/api.js";

// EXPORT EXCEL FINANCE (B3.9) — satu tombol untuk 11 halaman Finance.
//
// Berkas dibangun SERVER (exceljs): mengikuti izin pengguna, nominal jadi angka Excel, tanggal WIB, header Indonesia, dan
// pencegahan formula injection. Tombol ini hanya mengirim filter/periode yang SEDANG AKTIF di layar:
//   • modul yang difilter di server → kirim `filter` + `periode` (server menjalankan query yang sama dengan layar);
//   • modul yang difilter di klien   → kirim `ids` baris yang tampil (server memuat ulang baris itu lewat fungsi baca yang sama).
// `ambilBody()` dipanggil SAAT DIKLIK (bukan saat render) supaya selalu memakai state terbaru.

/** Susun kalimat filter aktif untuk kepala berkas: [["Status","Disetujui"],["Cari","kain"]] → "Status: Disetujui; Cari: kain". */
export function labelFilterAktif(pasangan) {
  const bagian = (pasangan || []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => `${k}: ${String(v).trim()}`);
  return bagian.length ? bagian.join("; ") : "Tanpa filter (semua data)";
}

export default function TombolExportExcel({ modul, ambilBody, disabled = false, label = "Export Excel", className, onError }) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");

  async function unduh() {
    if (sibuk) return;
    setSibuk(true); setGalat("");
    try {
      const { blob, namaFile } = await api.exportFinanceExcel(modul, ambilBody?.() || {});
      saveAs(blob, namaFile);
    } catch (e) {
      const pesan = e?.message || "Gagal mengekspor";
      setGalat(pesan);
      onError?.(pesan);
    } finally {
      setSibuk(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={unduh} disabled={disabled || sibuk} className={className} title="Unduh data yang sedang tampil (filter, pencarian, status, dan periode aktif) sebagai berkas Excel">
        {sibuk ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        {sibuk ? "Menyiapkan…" : label}
      </Button>
      {galat && !onError && <span role="alert" className="max-w-[260px] text-right text-[12px] text-red">{galat}</span>}
    </span>
  );
}
