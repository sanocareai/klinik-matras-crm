import React from "react";
import { Badge } from "@/components/ui/badge.jsx";

// Badge status Warehouse — memetakan kunci status ke label + warna.
//
// ⚠️ SELALU merender LABEL TEKS, tidak pernah warna saja (ketentuan
// aksesibilitas: "jangan hanya mengandalkan warna").
//
// Label dwibahasa: `label` (Inggris, istilah gudang yang lazim) ditampilkan
// sebagai teks badge, `labelId` (Indonesia) masuk ke atribut title supaya
// staf yang belum terbiasa istilahnya tetap terbantu tanpa membuat badge
// jadi panjang dua baris.
export default function StatusBadge({ map, value, className }) {
  const s = map?.[value];
  if (!s) return <Badge variant="neutral" className={className}>{value || "—"}</Badge>;
  return (
    <Badge variant={s.tone} className={className} title={s.labelId || undefined}>
      {s.label}
    </Badge>
  );
}
