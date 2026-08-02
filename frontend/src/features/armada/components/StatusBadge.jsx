import React from "react";
import { Badge } from "@/components/ui/badge.jsx";

// Badge status delivery — SATU tempat untuk memetakan kunci status ke label
// Indonesia + warna, dipakai tabel, kartu mobile, dan daftar issue.
//
// ⚠️ SELALU merender LABEL TEKS, tidak pernah warna saja. Ketentuan
// aksesibilitas spesifikasi: "Jangan hanya mengandalkan warna untuk status" —
// dan di lapangan, dispatcher membaca layar ini sambil menelepon, seringkali
// di layar yang warnanya tidak akurat.
export default function StatusBadge({ map, value, className }) {
  const s = map?.[value];
  if (!s) return <Badge variant="neutral" className={className}>{value || "—"}</Badge>;
  return <Badge variant={s.tone} className={className}>{s.label}</Badge>;
}
