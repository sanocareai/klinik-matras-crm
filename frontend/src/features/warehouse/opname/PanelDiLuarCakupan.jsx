import React, { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { satuan } from "./BarisHitung.jsx";

/** Bahan baru yang muncul sesudah sesi dibuat: tampil sebagai "di luar cakupan sesi" dengan tindakan eksplisit (tambahkan ke sesi, atau abaikan dengan alasan). Menahan penyerahan hitungan sampai diputuskan. */
export default function PanelDiLuarCakupan({ countId, daftar, bisa, onSelesai }) {
  const [abai, setAbai] = useState(null); const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(null); const [galat, setGalat] = useState("");
  if (!daftar?.length) return null;
  const jalan = async (m, tindakan) => {
    setSibuk(m.materialId); setGalat("");
    try { await api.putuskanCakupanOpname(countId, m.materialId, tindakan, tindakan === "ABAIKAN" ? alasan.trim() : undefined); setAbai(null); setAlasan(""); await onSelesai(); } catch (e) { setGalat(e.message); } finally { setSibuk(null); }
  };
  return (
    <section className="space-y-2 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-3" aria-label="Bahan di luar cakupan sesi" data-testid="di-luar-cakupan">
      <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-ink"><AlertTriangle size={14} className="text-orange" aria-hidden /> {daftar.length} bahan di luar cakupan sesi</h3>
      <p className="m-0 text-[12px] text-ink2">Bahan ini memenuhi kriteria sesi tetapi muncul setelah sesi dibuat, jadi tidak ikut dihitung secara otomatis. Putuskan satu per satu; hitungan tidak bisa diserahkan sebelum diputuskan.</p>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {daftar.map((m) => (
          <li key={m.materialId} className="rounded-btn bg-surface px-2.5 py-2 text-[12.5px]" data-testid="bahan-luar">
            <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1"><b className="text-ink">{m.kode}</b> <span className="text-ink2">{m.nama}</span> <span className="text-ink3">({satuan(m.satuan)})</span></span>
              {bisa && <><Button size="sm" onClick={() => jalan(m, "TAMBAHKAN")} disabled={sibuk === m.materialId} className="max-sm:min-h-11" data-testid="tambahkan-ke-sesi">{sibuk === m.materialId ? <Loader2 size={13} className="animate-spin" /> : null} Tambahkan ke sesi</Button>
                <Button size="sm" variant="secondary" onClick={() => setAbai(abai === m.materialId ? null : m.materialId)} className="max-sm:min-h-11" data-testid="abaikan-bahan">Abaikan…</Button></>}</div>
            {abai === m.materialId && <div className="mt-2 flex flex-wrap items-center gap-2"><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan tidak ikut sesi ini (wajib)" aria-label="Alasan mengabaikan" className={cn("min-w-0 flex-1 rounded-btn border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]")} data-testid="alasan-abaikan" />
              <Button size="sm" variant="destructive" disabled={alasan.trim().length < 3 || sibuk === m.materialId} onClick={() => jalan(m, "ABAIKAN")} className="max-sm:min-h-11" data-testid="konfirmasi-abaikan">Abaikan bahan ini</Button></div>}
          </li>
        ))}
      </ul>
      {galat && <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>}
    </section>
  );
}
