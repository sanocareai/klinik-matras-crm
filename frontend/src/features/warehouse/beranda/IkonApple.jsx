import React from "react";

// Ikon Beranda Gudang bergaya SF Symbols: glif garis 1.8 berujung bulat dengan isian lembut, ditaruh di "ubin" squircle bergradien seperti ikon aplikasi iOS.
// Hanya untuk Beranda (tidak mengubah gudangIcons.jsx yang dipakai halaman Gudang lain). Dekoratif: selalu aria-hidden; arti disampaikan oleh teks di sebelahnya.
const P = {
  truk: <><path d="M3 7.6A1.6 1.6 0 0 1 4.6 6h8.2a1.6 1.6 0 0 1 1.6 1.6V16H3z" fill="currentColor" fillOpacity=".22" /><path d="M14.4 9.6h3.5a1.6 1.6 0 0 1 1.3.7L21 13v3h-6.6" /><circle cx="7.4" cy="17.2" r="1.9" fill="currentColor" fillOpacity=".22" /><circle cx="17.2" cy="17.2" r="1.9" fill="currentColor" fillOpacity=".22" /></>,
  dokumen: <><path d="M7 3h7l4.6 4.6V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" fillOpacity=".22" /><path d="M14 3v4.6h4.6M8.5 12.6h7M8.5 16.2h4.6" /></>,
  kotak: <><path d="M12 3.2l8 4.2v9.2l-8 4.2-8-4.2V7.4z" fill="currentColor" fillOpacity=".22" /><path d="M4.2 7.5L12 11.6l7.8-4.1M12 11.6v9.2" /></>,
  awas: <><path d="M12 3.9l9.1 15.6H2.9z" fill="currentColor" fillOpacity=".22" /><path d="M12 9.8v4.3" /><circle cx="12" cy="16.7" r=".55" fill="currentColor" /></>,
  jam: <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".22" /><path d="M12 7v5.2l3.2 1.9" /></>,
  perkakas: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z" fill="currentColor" fillOpacity=".22" />,
  muatUlang: <path d="M20 12.2a8 8 0 1 1-2.5-5.8M20 4.6v4.6h-4.6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.2" /><circle cx="12" cy="7.9" r=".6" fill="currentColor" /></>,
  cari: <><circle cx="11" cy="11" r="6.6" /><path d="M16 16l4.6 4.6" /></>,
  saring: <path d="M4 7h16M7 12h10M10 17h4" />,
  bawah: <path d="M6 9.5l6 6 6-6" />,
  kanan: <path d="M9.5 6l6 6-6 6" />,
  centang: <path d="M5 12.6l4.6 4.6L19 7.6" />,
  tutup: <path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4" />,
  keluar: <><path d="M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5" fill="currentColor" fillOpacity=".22" /><path d="M12 15V4M8 8l4-4 4 4" /></>,
  transfer: <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />,
  opname: <><path d="M7 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1" fill="currentColor" fillOpacity=".22" /><path d="M9 3.4h6v3.2H9zM8.6 14l2.5 2.5 4.4-5" /></>,
  restok: <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".22" /><path d="M12 8v8M8 12h8" /></>,
  retur: <path d="M9 7l-4.5 4.5L9 16M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-3" />,
  bank: <><path d="M3.2 9.4L12 4l8.8 5.4z" fill="currentColor" fillOpacity=".22" /><path d="M5.4 10.6v6.2M9.8 10.6v6.2M14.2 10.6v6.2M18.6 10.6v6.2M3.4 20h17.2" /></>,
  riwayat: <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".22" /><path d="M12 7.2V12l3.4 2M3.6 12H6.4M17.6 12h2.8" /></>,
  koreksi: <><path d="M4 20l1-4.2L16.6 4.6a2 2 0 0 1 2.8 2.8L7.8 19z" fill="currentColor" fillOpacity=".22" /><path d="M14.6 6.6l2.8 2.8" /></>,
};

export function Glif({ nama, size = 20, className, ...sisa }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className} {...sisa}>
      {P[nama] ?? P.dokumen}
    </svg>
  );
}

/** Ubin squircle bergradien dengan glif putih (gaya ikon aplikasi iOS). `nada`: biru | langit | ungu | oranye | hijau | merah | pink | abu | indigo | teal | kaca (di atas kartu berwarna). */
export function Ubin({ nada = "biru", nama, ukuran = 36, className = "" }) {
  return (
    <span className={`gud-br-ap gud-br-ap-${nada} ${className}`.trim()} style={{ "--ap": `${ukuran}px` }} aria-hidden="true">
      <Glif nama={nama} size={Math.round(ukuran * 0.56)} />
    </span>
  );
}

// Warna ubin per jenis dokumen (identitas jenis, bukan penilaian aman/tidak).
export const UBIN_JENIS = {
  penerimaan: { nada: "biru", nama: "dokumen" },
  po: { nada: "indigo", nama: "truk" },
  "pengeluaran-material": { nada: "oranye", nama: "keluar" },
  transfer: { nada: "teal", nama: "transfer" },
  opname: { nada: "ungu", nama: "opname" },
  restok: { nada: "hijau", nama: "restok" },
  rusak: { nada: "merah", nama: "awas" },
  retur: { nada: "pink", nama: "retur" },
  "retur-supplier": { nada: "pink", nama: "retur" },
  koreksi: { nada: "abu", nama: "koreksi" },
  penyesuaian: { nada: "abu", nama: "koreksi" },
  bahan: { nada: "oranye", nama: "perkakas" },
};
