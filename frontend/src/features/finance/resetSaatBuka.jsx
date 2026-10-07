import React, { useState } from "react";

// FORMULIR "BARU" HARUS KOSONG SETIAP DIBUKA (7 Okt 2026).
// Komponen formulir Finance (ModalPembelian, ModalTagihan, dst) selalu ter-mount oleh halamannya dan hanya menerima prop `open`; state isiannya (useState) karena itu
// TIDAK ikut hilang saat dialog ditutup. Isian pemakaian sebelumnya — termasuk dropdown Supplier — muncul lagi di formulir berikutnya dan mudah terlewat. Kasus nyata:
// PUR-07102026-009 tersimpan dengan supplier YULIUS (sisa dari pembelian lain) padahal "Dibeli dari" diisi EKA TUNGGAL.
//
// Pembungkus ini me-mount ULANG formulir (state baru) tepat saat `open` berubah false → true. Saat menutup TIDAK me-mount ulang, jadi animasi tutup dialog tetap jalan
// dan isian tidak berkedip. Pola "sesuaikan state saat render" (resmi React) dipakai supaya kunci baru berlaku di render yang sama dengan pembukaan — tanpa satu frame isian lama.
export function resetSaatBuka(Komponen) {
  function TerbungkusReset(props) {
    const [st, setSt] = useState({ open: !!props.open, sesi: 0 });
    const open = !!props.open;
    let sesi = st.sesi;
    if (open !== st.open) {
      sesi = open ? st.sesi + 1 : st.sesi;
      setSt({ open, sesi });
    }
    return <Komponen key={sesi} {...props} />;
  }
  TerbungkusReset.displayName = `ResetSaatBuka(${Komponen.displayName || Komponen.name || "Komponen"})`;
  return TerbungkusReset;
}
