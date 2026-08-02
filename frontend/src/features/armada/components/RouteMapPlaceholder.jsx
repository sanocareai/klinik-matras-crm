import React from "react";
import { MapPinned } from "lucide-react";

// Placeholder peta — SENGAJA bukan Google Maps (ketentuan #: "Jangan
// menggunakan API Maps"). Backend SUDAH punya services/maps.js yang
// menghitung jarak/durasi lewat Distance Matrix API kalau GOOGLE_MAPS_API_KEY
// diisi (dipakai /route/summary & POST /routes/:id/publish) — jadi
// strukturnya SIAP integrasi peta sungguhan, cuma tampilan visualnya yang
// ditunda sampai keputusan UI peta diambil.
export default function RouteMapPlaceholder({ stopCount }) {
  return (
    <div className="flex h-[180px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-border bg-inset">
      <MapPinned size={28} className="text-ink3" strokeWidth={1.5} aria-hidden />
      <p className="text-[12px] font-semibold text-ink2">Peta rute</p>
      <p className="text-[10.5px] text-ink3">
        {stopCount > 0 ? `${stopCount} titik akan tampil di sini` : "Integrasi peta menyusul"}
      </p>
    </div>
  );
}
