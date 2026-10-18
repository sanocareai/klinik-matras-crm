import React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card.jsx";
import { waktuTeks } from "./dokumenLogic.js";

/** Riwayat ringan dokumen Gudang (dibuat · disetujui · diubah · dikirim/diterima · dibatalkan · dibuat ulang). Dari server (`jejak`); tautan menuju dokumen terkait. */
export default function JejakDokumen({ jejak = [], basePath }) {
  if (!jejak.length) return null;
  return (
    <Card className="p-4" data-testid="jejak-dokumen">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Riwayat dokumen</h3>
      <ol className="m-0 list-none space-y-1.5 p-0 text-[12.5px]">
        {jejak.map((j) => (
          <li key={j.id} data-testid="jejak-baris" data-aksi={j.aksi}>
            <span className="font-semibold text-ink">{j.teks}</span>
            {j.tautan?.id && <> — <Link to={`${basePath}/${j.tautan.id}`} className="font-semibold text-accent">{j.tautan.nomor}</Link></>}
            <span className="text-ink3"> · {j.oleh ?? "—"} · {waktuTeks(j.waktu)}</span>
            {j.alasan && <div className="text-[11.5px] text-ink2">Alasan: {j.alasan}</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
