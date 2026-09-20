import React, { useEffect, useState } from "react";
import { Field } from "@/components/ui/field.jsx";
import { api } from "@/api.js";
import { Pilihan } from "@/features/finance/shared.jsx";

// "Ditalangi oleh" untuk dokumen bercara bayar Reimbursement.
// Daftar karyawan dari /finance/kasbon/karyawan-nama (butuh hak posting; yang cuma boleh mengajukan
// kena 403 → daftar kosong → kolom disembunyikan, karena mereka selalu menalangi diri sendiri).
// `saatIni` = { id, name } penalang yang sudah tersimpan; ditambahkan ke pilihan kalau
// tidak ada di daftar karyawan (mis. akun owner).
export default function PilihPenalang({ value, onChange, saatIni = null, kosongLabel = "Saya sendiri (yang menginput)" }) {
  const [karyawan, setKaryawan] = useState([]);
  useEffect(() => {
    let batal = false;
    api.getFinanceKasbonNama()
      .then((o) => { if (!batal) setKaryawan((o.karyawan || []).map((k) => ({ id: k.id, name: k.name }))); })
      .catch(() => {});
    return () => { batal = true; };
  }, []);

  const pilihan = saatIni && !karyawan.some((k) => k.id === saatIni.id) ? [saatIni, ...karyawan] : karyawan;
  if (pilihan.length === 0) return null;

  return (
    <Field label="Ditalangi oleh" hint="Siapa yang memakai uang pribadinya dan akan diganti perusahaan">
      <Pilihan value={value} onChange={onChange}>
        <option value="">{kosongLabel}</option>
        {pilihan.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </Pilihan>
    </Field>
  );
}
