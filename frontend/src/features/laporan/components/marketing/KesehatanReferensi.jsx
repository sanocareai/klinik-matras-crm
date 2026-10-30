import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { angka } from "../../akuisisiLogic.js";
import { berurutan, pesanGalat } from "../../marketingData.js";

// Kesehatan capture + referensi pemetaan Ad → Ad Set → Campaign (BACA-SAJA; endpoint existing /kesehatan, /referensi, /ekspor-id). Impor pemetaan tetap lewat POST /api/atribusi/iklan/referensi
// (dry-run default) — belum ada layar impor di aplikasi; panel ini menyediakan daftar ID untuk dicocokkan dengan Ads Manager/Windsor.
const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function unduhCsv(baris) {
  const kol = ["campaignId", "adSetId", "adId", "status", "campaignName", "adSetName", "adName", "touch", "pertama", "terakhir"];
  const csv = [kol.join(","), ...baris.map((r) => kol.map((k) => esc(r[k])).join(","))].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = "ad-id-iklan.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export default function KesehatanReferensi() {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(null); const [sibuk, setSibuk] = useState(true);
  const muat = useCallback(async () => {
    setSibuk(true); setGalat(null);
    try {
      const [k, r] = await Promise.all([api.getAtribusiKesehatan(), api.getAtribusiReferensi()]);
      setD({ k, r });
    } catch (e) { setD(null); setGalat(pesanGalat(e, "Gagal memuat kesehatan atribusi.")); }
    finally { setSibuk(false); }
  }, []);
  useEffect(() => { muat(); }, [muat]);
  const ekspor = async () => { try { const r = await berurutan(() => api.getAtribusiEksporId()); unduhCsv(r.iklan || []); } catch (e) { setGalat(pesanGalat(e, "Gagal mengekspor ID iklan.")); } };
  if (sibuk && !d) return <Card className="!p-4"><p className="flex items-center gap-2 text-sm text-ink3"><Loader2 size={16} className="animate-spin" /> Memuat…</p></Card>;
  if (galat && !d) return <Card className="!p-4"><p className="text-sm text-red">{galat}</p></Card>;
  const { k, r } = d;
  const Baris = ({ a, b }) => <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1.5 last:border-0"><dt className="t-secondary text-[12.5px]">{a}</dt><dd className="m-0 text-right text-[13px] font-medium tabular-nums text-ink">{b}</dd></div>;
  return (
    <Card className="flex flex-col gap-3 !p-4" data-testid="panel-kesehatan">
      <div className="grid gap-4 md:grid-cols-2">
        <dl className="m-0">
          <h4 className="mb-1 text-[13px] font-semibold text-ink">Kesehatan capture touch</h4>
          <Baris a="Capture aktif" b={k.captureAktif ? "Ya" : "Tidak"} />
          <Baris a="Touch 24 jam / 7 hari" b={`${angka(k.db?.touch24Jam)} / ${angka(k.db?.touch7Hari)}`} />
          <Baris a="Touch terbaru" b={k.db?.usiaTouchTerbaruJam != null ? `${k.db.usiaTouchTerbaruJam} jam lalu` : "—"} />
          <Baris a="Gagal / tertunda (proses ini)" b={`${angka(k.proses?.gagal)} / ${angka(k.proses?.tertunda)}`} />
          <Baris a="Pending pemetaan" b={`${angka(k.db?.pendingPemetaan?.touch)} touch · ${angka(k.db?.pendingPemetaan?.adIdUnik)} Ad ID`} />
        </dl>
        <dl className="m-0">
          <h4 className="mb-1 text-[13px] font-semibold text-ink">Referensi pemetaan</h4>
          <Baris a="Referensi tersimpan" b={angka(r.jumlah)} />
          <Baris a="Sinkron terakhir" b={k.db?.referensi?.sinkronTerakhir ? k.db.referensi.sinkronTerakhir.slice(0, 16).replace("T", " ") + " UTC" : "—"} />
          <Baris a="Ad ID belum terpetakan" b={angka((r.tidakTerpetakan || []).length)} />
          <Baris a="Sumber impor tersedia" b={(r.sumberTersedia || []).join(", ") || "—"} />
        </dl>
      </div>
      {(r.tidakTerpetakan || []).length > 0 && (
        <div className="rounded-btn bg-inset p-3 text-[12.5px]" data-testid="daftar-unmapped">
          <p className="mb-1 font-semibold text-ink">Ad ID belum terpetakan (jangan ditebak dari nama)</p>
          <ul className="m-0 grid list-none gap-x-4 gap-y-0.5 p-0 sm:grid-cols-2">{r.tidakTerpetakan.slice(0, 20).map((x) => <li key={x.adId} className="tabular-nums text-ink2">{x.adId} <span className="t-secondary">· {angka(x.touch)} touch</span></li>)}</ul>
          {r.tidakTerpetakan.length > 20 && <p className="t-secondary mt-1">… +{r.tidakTerpetakan.length - 20} lainnya (unduh daftar lengkap).</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={ekspor}><Download size={14} /> Unduh daftar ID iklan (CSV)</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={muat} disabled={sibuk}>Muat ulang</button>
      </div>
      <p className="t-secondary text-[11.5px]">{r.catatan} Impor pemetaan dari ekspor Ads Manager/Windsor: <code>POST /api/atribusi/iklan/referensi</code> (dry-run bawaan; konflik hierarki tidak ditimpa). Sistem tidak mengubah campaign, ad set, ads, atau budget Meta.</p>
      {galat && <p className="text-[12px] text-orange">{galat}</p>}
    </Card>
  );
}
