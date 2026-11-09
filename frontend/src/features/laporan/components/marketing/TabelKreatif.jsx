import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, MessageSquare } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { formatRupiah } from "@/utils/format.js";
import { kueriIklan } from "../../iklanCampaignLogic.js";
import { kelompokkanKreatif } from "../../kanalPakem.js";
import { berurutan, pesanGalat } from "../../marketingData.js";

// Tampilan Per kreatif: iklan bernama sama di beberapa ad set atau campaign digabung, supaya satu kreatif bisa dinilai utuh. Memakai laporan level iklan yang sama dengan tabel campaign.
const angka = (n) => Number(n || 0).toLocaleString("id-ID");
const Th = ({ children, kiri }) => <th scope="col" className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink3 ${kiri ? "text-left" : "text-right"}`}>{children}</th>;
const Td = ({ children }) => <td className="px-3 py-2 text-right align-top text-[13px] tabular-nums text-ink">{children}</td>;

export default function TabelKreatif({ range, periode, cache, versi, onLihatChat }) {
  const [lap, setLap] = useState(null);
  const [galat, setGalat] = useState(null);
  const [coba, setCoba] = useState(0);
  const q = useMemo(() => kueriIklan({ range, level: "ad" }), [range]);
  const kunci = JSON.stringify(q);
  useEffect(() => {
    let batal = false;
    if (!periode.ok) { setLap(null); return undefined; }
    const ada = cache?.current?.get(kunci);
    if (ada) { setLap(ada); setGalat(null); return undefined; }
    setLap(null); setGalat(null);
    berurutan(() => api.getAtribusiIklan(q), { batal: () => batal })
      .then((r) => { cache?.current?.set(kunci, r); if (!batal) setLap(r); })
      .catch((e) => { if (!batal && !e?.dibatalkan) setGalat(pesanGalat(e, "Gagal memuat laporan per kreatif.")); });
    return () => { batal = true; };
  }, [kunci, q, periode.ok, cache, versi, coba]);
  const baris = useMemo(() => kelompokkanKreatif(lap?.grup), [lap]);

  if (galat) return <Card className="!p-4"><p className="flex flex-wrap items-center gap-2 text-sm text-red" role="alert"><AlertTriangle size={16} /> {galat} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCoba((c) => c + 1)}>Coba lagi</button></p></Card>;
  if (!lap) return <Card className="!p-0"><div className="flex h-40 items-center justify-center text-ink3"><Loader2 className="animate-spin" size={18} /></div></Card>;
  return (
    <Card className="overflow-x-auto !p-0">
      <table className="w-full min-w-[820px] border-collapse text-sm" data-testid="tabel-kreatif">
        <thead><tr className="border-b border-line"><Th kiri>Kreatif</Th><Th>Iklan</Th><Th>Lead</Th><Th>Spam</Th><Th>Ber-order</Th><Th>Membayar</Th><Th>Lunas</Th><Th>Nilai order</Th><Th>Biaya</Th><Th><span className="sr-only">Aksi</span></Th></tr></thead>
        <tbody>
          {baris.length === 0 && <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-ink3">Belum ada lead dengan iklan terpetakan di rentang ini.</td></tr>}
          {baris.map((k) => (
            <tr key={k.nama} className="border-b border-line/60" data-testid="baris-kreatif">
              <td className="px-3 py-2 text-left align-top text-[13px] font-medium text-ink">{k.nama}</td>
              <Td>{angka(k.iklan)}</Td><Td>{angka(k.lead)}</Td><Td>{angka(k.spam)}</Td><Td>{angka(k.berOrder)}</Td><Td>{angka(k.membayar)}</Td><Td>{angka(k.lunas)}</Td><Td>{formatRupiah(k.nilai)}</Td><Td>{k.biayaAda ? formatRupiah(k.biaya) : "—"}</Td>
              <td className="px-3 py-1.5 text-right align-top"><button type="button" className="btn btn-ghost btn-sm whitespace-nowrap" onClick={() => onLihatChat({ judul: k.nama, sub: `${angka(k.lead)} chat dari ${angka(k.iklan)} iklan`, query: { kreatif: k.nama } })}><MessageSquare size={14} /> Lihat chat</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
