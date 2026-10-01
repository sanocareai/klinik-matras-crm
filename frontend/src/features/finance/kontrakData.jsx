import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";

// Hook & potongan UI kontrak yang TIDAK bergantung shared.jsx (supaya KartuAngka di shared.jsx boleh memakainya tanpa impor melingkar).
// Semua definisi datang dari server — lihat kontrak.jsx untuk komponen jembatan/panel.

let cache = null;
let janji = null;
export function muatKontrak() {
  if (cache) return Promise.resolve(cache);
  if (!janji) {
    janji = api.getFinanceKontrakMetrik()
      .then((k) => { cache = { ...k, peta: new Map(k.metrik.map((m) => [m.kunci, m])) }; return cache; })
      .catch((e) => { janji = null; throw e; });
  }
  return janji;
}

/** Kontrak metrik (di-cache seumur sesi). `null` selama memuat/gagal — pemanggil harus tetap tampil benar tanpa kontrak (kartu memakai `info` lama). */
export function useKontrak() {
  const [k, setK] = useState(cache);
  useEffect(() => {
    let batal = false;
    if (!cache) muatKontrak().then((v) => { if (!batal) setK(v); }).catch(() => {});
    return () => { batal = true; };
  }, []);
  return k;
}

/** Isi tooltip kartu dari kontrak: definisi, cara hitung, basis tanggal, yang tidak termasuk. */
export function IsiDefinisi({ m }) {
  return (
    <span className="block space-y-1.5">
      <span className="block font-semibold text-ink">{m.nama}</span>
      <span className="block">{m.definisi}</span>
      <span className="block"><b className="font-semibold text-ink">Dihitung: </b>{m.rumus}</span>
      <span className="block"><b className="font-semibold text-ink">Tanggal: </b>{m.basisLabel}</span>
      {m.tidakTermasuk?.length > 0 && <span className="block"><b className="font-semibold text-ink">Tidak termasuk: </b>{m.tidakTermasuk.join("; ")}</span>}
    </span>
  );
}

/** Chip kecil basis tanggal — selalu terlihat di kartu supaya "tanggal yang mana" tidak perlu ditebak. */
export function ChipBasis({ label, className }) {
  if (!label) return null;
  return (
    <span className={cn("mt-1.5 inline-flex max-w-full items-center rounded-full bg-inset px-2 py-0.5 text-[11px] font-medium text-ink3", className)} title="Tanggal yang dipakai untuk menghitung angka ini">
      <span className="truncate">Tanggal: {label}</span>
    </span>
  );
}

