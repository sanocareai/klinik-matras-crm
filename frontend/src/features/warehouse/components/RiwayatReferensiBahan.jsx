import React, { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { LABEL_REFERENSI, STATUS_REFERENSI, ANTREAN_REFERENSI, teksJumlah, teksTanggal, teksSumber } from "../riwayatReferensiLogic.js";

// Riwayat referensi dari file untuk SATU bahan — dipisah dari Movement History (ledger resmi). Bukan transaksi, bukan saldo.
export default function RiwayatReferensiBahan({ materialId }) {
  const [data, setData] = useState(null); const [err, setErr] = useState("");
  useEffect(() => {
    let batal = false; setData(null); setErr("");
    api.getRiwayatReferensiMaterial(materialId).then((d) => { if (!batal) setData(d); }).catch((e) => { if (!batal) setErr(e.message); });
    return () => { batal = true; };
  }, [materialId]);
  if (err) return null; // pembaca tanpa izin / belum ada impor: bagian ini tidak mengganggu detail bahan
  if (!data) return <p className="flex items-center gap-1.5 py-2 text-[11.5px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat riwayat referensi…</p>;
  if (data.baris.length === 0) return null;
  return (
    <div className="mt-4 rounded-md border border-orange/30 bg-orange/10 px-3 py-2" data-testid="riwayat-referensi-bahan">
      <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-orange"><FileText size={12} aria-hidden /> Riwayat referensi dari file (bukan transaksi)</h4>
      <p className="mb-2 text-[10.5px] leading-relaxed text-ink2">{LABEL_REFERENSI}</p>
      <ul className="divide-y divide-line">
        {data.baris.map((r) => (
          <li key={r.id} className="py-1.5 text-[11.5px] text-ink2">
            <div className="flex flex-wrap items-center gap-1.5">
              <b>{r.nomorOrder || r.suratJalan || "—"}</b><span>{teksJumlah(r)}</span>
              <Badge variant={STATUS_REFERENSI[r.statusVerifikasi]?.tone || "neutral"} title={STATUS_REFERENSI[r.statusVerifikasi]?.arti}>{STATUS_REFERENSI[r.statusVerifikasi]?.label || r.statusVerifikasi}</Badge>
              {r.antrean && <span className="text-red">{ANTREAN_REFERENSI[r.antrean]}</span>}
            </div>
            <p className="text-[10.5px] text-ink3">{teksTanggal(r)} · {teksSumber(r)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
