import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Clock, Maximize2, PackageX } from "lucide-react";
import { api } from "@/api.js";
import { BUCKET_STYLE, bucketStyle, formatMinutes, initials, wibDate } from "@/features/production/experience.js";

// Live TV Andon (kiosk 1920×1080, read-only, tetap wajib login). Polling ringan 20 detik HANYA saat tab terlihat — tanpa infra baru.
const POLL_MS = 20_000;
const ORDER = ["ANTREAN", "BONGKAR", "DIAGNOSA", "MENUNGGU_BAHAN", "FONDASI", "LAPISAN", "QC", "CORNER", "HANDOFF", "SELESAI"];

function Clock24() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  return <span className="tabular-nums">{now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}</span>;
}

function Tile({ item }) {
  const st = bucketStyle(item.bucket);
  const late = item.timer?.late;
  return (
    <div className={`relative flex h-full min-h-0 flex-col justify-between gap-1.5 overflow-hidden rounded-2xl bg-surface py-3 pl-6 pr-4 shadow-sm ${late ? "ring-4 ring-red" : ""}`}>
      <span className={`absolute inset-y-0 left-0 w-2.5 ${st.dot}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[30px] font-extrabold leading-none tracking-tight text-ink">{item.unitCode.replace(/^RES-\d{8}-/, "")}</p>
          <p className="mt-0.5 truncate text-[19px] leading-tight text-ink2">{item.customerName || "—"}</p>
        </div>
        {item.priority > 0 && <span className={`rounded-lg px-3 py-1 text-[18px] font-bold ${item.priority === 2 ? "bg-red text-white" : "bg-orangebg text-orange"}`}>{item.priority === 2 ? "MENDESAK" : "PRIORITAS"}</span>}
      </div>
      <div className={`shrink-0 truncate rounded-xl px-3 py-1.5 text-[21px] font-bold leading-tight ${st.tv}`}>
        {st.label}{item.stepNo ? <span className="font-semibold opacity-90"> · Tahap {item.stepNo}</span> : null}
      </div>
      {item.shortage?.length > 0 && (
        <p className="flex items-center gap-2 truncate text-[17px] font-semibold leading-tight text-red"><PackageX size={22} aria-hidden /> {item.shortage.join(", ")}</p>
      )}
      <div className="flex items-center justify-between gap-2 text-[17px] leading-tight text-ink2">
        <span className="flex items-center gap-2"><Clock size={20} aria-hidden /> {formatMinutes(item.timer?.stepElapsedMinutes || item.timer?.elapsedMinutes)}</span>
        <span className="tabular-nums">{item.progress.done}/{item.progress.total} tahap</span>
        {late && <span className="flex items-center gap-1 font-bold text-red"><AlertTriangle size={20} aria-hidden /> Terlambat</span>}
      </div>
      <div className="h-2 shrink-0 overflow-hidden rounded-full bg-line"><div className={`h-full ${st.dot}`} style={{ width: `${item.progress.total ? (item.progress.done / item.progress.total) * 100 : 0}%` }} /></div>
    </div>
  );
}

export default function ProductionAndon() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const date = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("date") || wibDate(0);

  const load = useCallback(() => {
    api.getProductionV2Andon(date)
      .then((d) => { setData(d); setError(""); setUpdatedAt(new Date()); })
      .catch((e) => setError(e.message || "Gagal memuat data"));
  }, [date]);
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  const fullscreen = () => { document.documentElement.requestFullscreen?.().catch(() => {}); };
  const stale = updatedAt && Date.now() - updatedAt.getTime() > POLL_MS * 3;

  return (
    <div className="flex h-[100dvh] min-h-[720px] flex-col overflow-hidden bg-base p-6 text-ink [&_p]:m-0">
      <header className="mb-4 flex items-center gap-5">
        <Link to="/bengkel/production-v2" aria-label="Kembali" className="flex h-12 w-12 items-center justify-center rounded-xl text-ink3 hover:bg-hovertint"><ArrowLeft size={24} aria-hidden /></Link>
        <div className="flex-1">
          <p className="text-[36px] font-extrabold leading-none">Andon Produksi</p>
          <p className="mt-1 text-[20px] text-ink3">{new Date(`${date}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        {data?.kpi && (
          <div className="flex gap-3">
            {[["Target", data.kpi.target], ["Direncanakan", data.kpi.planned], ["Selesai", data.kpi.completed], ["Tunggu Bahan", data.kpi.waitingMaterial], ["Terlambat", data.kpi.late]].map(([label, value]) => (
              <div key={label} className={`rounded-xl px-5 py-2 text-center ${label === "Tunggu Bahan" && value ? "bg-red text-white" : label === "Terlambat" && value ? "bg-orange text-white" : "bg-surface"}`}>
                <p className="text-[32px] font-extrabold leading-none tabular-nums">{value}</p>
                <p className="text-[15px] opacity-80">{label}</p>
              </div>
            ))}
          </div>
        )}
        <div className="text-right"><p className="text-[40px] font-extrabold leading-none"><Clock24 /></p><p className={`text-[14px] ${stale ? "font-bold text-red" : "text-ink3"}`}>{stale ? "Data tidak terbarui" : "Otomatis diperbarui"}</p></div>
        <button type="button" onClick={fullscreen} aria-label="Layar penuh" className="flex h-12 w-12 items-center justify-center rounded-xl text-ink3 hover:bg-hovertint"><Maximize2 size={22} aria-hidden /></button>
      </header>

      {error && !data && <p role="alert" className="rounded-xl bg-redbg p-6 text-[24px] text-red">{error}</p>}
      {data?.readerMode === "OFF" && <p className="rounded-xl bg-surface p-10 text-center text-[28px] text-ink3">Produksi V2 belum aktif untuk papan ini.</p>}

      {data?.stations?.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-5">
          {data.stations.map((s) => (
            <section key={s.code} className="flex min-h-0 flex-col rounded-2xl bg-inset p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[26px] font-extrabold">{s.label}</p>
                <div className="flex items-center gap-2">
                  {s.operatorNames.map((n) => <span key={n} title={n} className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-[17px] font-bold text-white">{initials(n)}</span>)}
                  <span className="text-[20px] text-ink3 tabular-nums">{s.items.length}/{s.capacity}</span>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateRows: `repeat(${s.capacity}, minmax(0, 1fr))` }}>
                {Array.from({ length: s.capacity }, (_, i) => s.items[i]
                  ? <Tile key={s.items[i].runId} item={s.items[i]} />
                  : <div key={`empty-${i}`} className="flex items-center justify-center rounded-2xl border-2 border-dashed border-line text-[20px] text-ink3">Kosong</div>)}
              </div>
            </section>
          ))}
        </div>
      )}

      {data?.counts && (
        <footer className="mt-4 flex flex-wrap gap-2">
          {ORDER.map((key) => (
            <span key={key} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[18px] font-semibold ${BUCKET_STYLE[key].tv}`}>
              {BUCKET_STYLE[key].label} <b className="tabular-nums">{data.counts[key] ?? 0}</b>
            </span>
          ))}
        </footer>
      )}
    </div>
  );
}
