import React from "react";
import { Badge } from "@/components/ui/badge.jsx";

// Kurir pihak ketiga (Lalamove/dst) — D-161, 13 September 2026. `person`
// diterima LONGGAR (driver ATAU helper object dari jobInclude, atau null)
// supaya dipanggil sama di semua tempat driver/helper ditampilkan, tanpa
// tiap pemanggil menulis ulang null-check sendiri.
export default function ExternalCourierBadge({ person, className }) {
  if (!person?.isExternalCourier) return null;
  return (
    <Badge variant="accent" className={className}>Kurir Eksternal</Badge>
  );
}
