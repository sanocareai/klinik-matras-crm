import React, { useCallback, useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import PenerimaanWorkshopModal from "@/features/production/PenerimaanWorkshopModal.jsx";

// Antrean petugas Gudang: unit yang pickup-nya SUDAH selesai tetapi belum ada catatan diterima di workshop.
// Satu tombol "Catat diterima" per unit — tanpa membuka workspace Produksi dan tanpa mengaktifkan Produksi V2 (lihat PenerimaanWorkshopModal untuk dampaknya).

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function MenungguPenerimaanSection({ boleh = true, onChanged }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const [target, setTarget] = useState(null);
  const [notice, setNotice] = useState("");

  const muat = useCallback(() => {
    api.getPenerimaanWorkshopMenunggu({ limit: "50" }).then((d) => { setData(d); setGalat(""); }).catch((e) => setGalat(e.message || "Gagal memuat antrean penerimaan"));
  }, []);
  useEffect(() => { muat(); }, [muat]);

  if (galat) return <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat}</div>;
  if (!data) return null;
  return (
    <section aria-labelledby="menunggu-diterima" data-testid="menunggu-penerimaan" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="menunggu-diterima" className="m-0 text-[14px] font-semibold text-ink">Menunggu dicatat diterima di workshop</h2>
        <span className="text-[12px] text-ink3">{data.total} unit · pickup selesai, penerimaan fisik belum tercatat</span>
      </div>
      {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</div>}
      {data.units.length === 0 ? (
        <Card className="p-4 text-[13px] text-ink3">Tidak ada unit yang menunggu dicatat diterima.</Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden p-0">
          {data.units.map((u) => (
            <div key={u.unitId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="menunggu-baris">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-bold text-ink">{u.unitCode}</p>
                <p className="m-0 text-[12px] text-ink3">{[u.orderNumber ? `Order ${u.orderNumber}` : null, u.customerName, u.merk, u.ukuran].filter(Boolean).join(" · ")} · pickup selesai {waktu(u.sejak)}</p>
              </div>
              {boleh && <Button size="sm" className="min-h-[44px]" data-testid="menunggu-catat" onClick={() => setTarget(u)}><PackageCheck size={14} aria-hidden /> Catat diterima</Button>}
            </div>
          ))}
        </Card>
      )}
      {target && <PenerimaanWorkshopModal unit={target} onClose={() => setTarget(null)} onDone={(pesan) => { setTarget(null); setNotice(pesan); muat(); onChanged?.(); }} />}
    </section>
  );
}
