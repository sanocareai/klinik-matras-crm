import React, { useState } from "react";
import { validasiUkuranCustom, UKURAN_CUSTOM_MIN_CM, UKURAN_CUSTOM_MAX_CM } from "@/utils/ukuranKasur.js";

// Field Lebar & Panjang (cm) untuk "Ukuran Custom" — dipakai Buat Order, Edit Order, dan setiap item Buat Resi.
// Kedua field WAJIB; angka positif dengan batas wajar (MIN–MAX cm); pesan galat Bahasa Indonesia. Galat tampil setelah field disentuh (blur)
// atau setelah pengguna mencoba menyimpan (`paksa`). Komponen ini hanya tampil bila induk memutuskan ukuran = "Ukuran Custom".
const kolom = "h-9 w-full rounded-lg bg-surface px-3 text-sm tabular-nums text-ink placeholder:text-ink3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40";

// bolehKosong: edit order LEGACY yang tidak mengubah ukuran — kedua field boleh dibiarkan kosong (data lama tidak ditebak); bila salah satu diisi, keduanya divalidasi.
export default function UkuranCustomFields({ lebar, panjang, onLebar, onPanjang, paksa = false, bolehKosong = false, idAwal = "ukuran-custom", className = "" }) {
  const [sentuh, setSentuh] = useState({ lebar: false, panjang: false });
  const v = validasiUkuranCustom({ lebar, panjang });
  const kosongSemua = String(lebar ?? "").trim() === "" && String(panjang ?? "").trim() === "";
  const galat = (k) => ((paksa || sentuh[k]) && !(bolehKosong && kosongSemua) && v.galat[k]) || "";
  const baris = [
    { k: "lebar", label: "Lebar (cm)", nilai: lebar, ubah: onLebar, contoh: "mis. 145" },
    { k: "panjang", label: "Panjang (cm)", nilai: panjang, ubah: onPanjang, contoh: "mis. 205" },
  ];
  return (
    <div className={"grid grid-cols-2 gap-2 " + className} data-testid="ukuran-custom">
      {baris.map((b) => (
        <div key={b.k} className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${idAwal}-${b.k}`} className="text-xs font-medium text-ink2">
            {b.label}{!bolehKosong && <span className="ml-0.5 text-red" aria-hidden="true">*</span>}
          </label>
          <input
            id={`${idAwal}-${b.k}`} type="text" inputMode="decimal" autoComplete="off"
            value={b.nilai} onChange={(e) => b.ubah(e.target.value)}
            onBlur={() => setSentuh((s) => ({ ...s, [b.k]: true }))}
            placeholder={b.contoh} required={!bolehKosong} aria-required={bolehKosong ? undefined : "true"}
            aria-invalid={galat(b.k) ? true : undefined} aria-describedby={galat(b.k) ? `${idAwal}-${b.k}-galat` : undefined}
            className={kolom + (galat(b.k) ? " ring-2 ring-red/50" : "")}
          />
          {galat(b.k) ? (
            <p id={`${idAwal}-${b.k}-galat`} role="alert" className="text-[11px] leading-snug text-red">{galat(b.k)}</p>
          ) : null}
        </div>
      ))}
      <p className="col-span-2 text-[11px] text-ink3">
        {bolehKosong ? "Data lama belum memiliki ukuran. Boleh dikosongkan bila ukuran tidak diubah; bila diisi, Lebar dan Panjang wajib keduanya. " : "Wajib diisi. "}
        Antara {UKURAN_CUSTOM_MIN_CM} dan {UKURAN_CUSTOM_MAX_CM} cm; boleh satu angka di belakang koma (mis. 145,5).
      </p>
    </div>
  );
}
