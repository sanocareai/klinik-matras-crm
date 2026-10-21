import React from "react";
import { AlertTriangle, Info, Target } from "lucide-react";
import KartuUnit from "@/features/production/rencana/KartuUnit.jsx";
import { labelHari, labelTanggal } from "@/features/production/rencana/rencanaModel.js";

// Kalender mingguan RINGKAS: satu sel per hari (kapasitas, terencana Admin/V2, target selesai, perlu perhatian). Hari/meja kosong tidak memakai panel besar.
// Klik hari = membuka rincian meja + daftar unit. Hari juga target lepas (seret) dan SEMUA tindakan tetap bisa lewat tombol/keyboard.
export function WeekStrip({ minggu, hari, onPilih, dragAktif, onLepas, loading }) {
  if (!minggu) return <div className="h-[92px] animate-pulse rounded-card bg-inset" aria-busy="true" />;
  return (
    <div className="-mx-1 max-w-full min-w-0 overflow-x-auto px-1 pb-1" data-testid="week-strip">
      <ol className="m-0 grid min-w-[640px] list-none grid-cols-7 gap-2 p-0">
        {minggu.days.map((d) => {
          const total = Math.max(minggu.kapasitas.total, 1);
          const pAdmin = Math.min((d.admin / total) * 100, 100); const pV2 = Math.min((d.v2 / total) * 100, 100 - pAdmin);
          const aktif = d.date === hari;
          return (
            <li key={d.date}>
              <button
                type="button" aria-pressed={aktif} aria-label={`${labelTanggal(d.date)}: ${d.terencana} dari ${d.kapasitas} unit terencana${d.perhatian ? `, ${d.perhatian} perlu perhatian` : ""}${d.targetSelesai ? `, ${d.targetSelesai} target selesai` : ""}`}
                data-testid="hari-sel" data-date={d.date} data-aktif={aktif ? "1" : "0"} data-penuh={d.penuh ? "1" : "0"}
                onClick={() => onPilih(d.date)}
                onDragOver={dragAktif ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
                onDrop={dragAktif ? (e) => { e.preventDefault(); onLepas?.(d.date); } : undefined}
                className={`flex w-full flex-col gap-1 rounded-card border px-2.5 py-2 text-left transition-colors ${aktif ? "border-accent bg-accentbg" : "border-line bg-surface hover:bg-inset"} ${d.isPast ? "opacity-70" : ""} ${dragAktif ? "ring-1 ring-accent/40" : ""}`}
              >
                <span className="flex items-baseline justify-between">
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${aktif ? "text-accent" : "text-ink3"}`}>{d.hari}{d.isToday ? " · hari ini" : ""}</span>
                  <span className="text-[15px] font-semibold text-ink">{Number(d.date.slice(8))}</span>
                </span>
                <span className="flex items-center justify-between text-[12px]">
                  <span className={`font-semibold ${d.penuh ? "text-red" : "text-ink"}`}>{d.terencana}<span className="font-normal text-ink3">/{d.kapasitas} unit</span></span>
                  {d.perhatian > 0 && <span className="inline-flex items-center gap-0.5 text-orange" title={`${d.perhatian} unit perlu perhatian`}><AlertTriangle size={12} aria-hidden />{d.perhatian}</span>}
                </span>
                <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-inset" aria-hidden>
                  <span className="h-full bg-accent" style={{ width: `${pAdmin}%` }} /><span className="h-full bg-green" style={{ width: `${pV2}%` }} />
                </span>
                <span className="flex items-center justify-between text-[11px] text-ink3">
                  <span>{d.admin ? `Admin ${d.admin}` : ""}{d.admin && d.v2 ? " · " : ""}{d.v2 ? `Berjalan ${d.v2}` : ""}{!d.admin && !d.v2 ? "Kosong" : ""}</span>
                  {d.targetSelesai > 0 && <span className="inline-flex items-center gap-0.5" title="Unit dengan target selesai pada hari ini"><Target size={11} aria-hidden />{d.targetSelesai}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {loading && <span className="sr-only" role="status">Memuat minggu…</span>}
    </div>
  );
}

function MejaBaris({ s, dragAktif, onLepasMeja, children }) {
  const kosong = s.items.length === 0;
  return (
    <section
      className={`rounded-card border ${kosong ? "border-dashed border-line bg-transparent" : "border-line bg-surface"} ${dragAktif ? "ring-1 ring-accent/40" : ""}`}
      data-testid="meja-baris" data-meja={s.code} data-count={s.items.length}
      onDragOver={dragAktif ? (e) => { e.preventDefault(); } : undefined} onDrop={dragAktif ? (e) => { e.preventDefault(); onLepasMeja?.(s.code); } : undefined}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <h3 className="m-0 text-[13px] font-semibold text-ink">{s.label} <span className={`font-normal ${s.items.length >= s.capacity ? "text-red" : "text-ink3"}`}>· {s.items.length}/{s.capacity} unit</span></h3>
        <span className="min-w-0 text-[12px] text-ink3">{s.pic ? <>PIC {s.pic.nama}{s.pic.aktif === false ? " (nonaktif)" : ""}</> : "PIC belum ditetapkan"}{kosong ? ` · ${s.capacity} tempat kosong` : s.items.length < s.capacity ? ` · ${s.capacity - s.items.length} tempat kosong` : " · penuh"}</span>
      </header>
      {!kosong && <div className="space-y-2 px-2 pb-2">{children}</div>}
    </section>
  );
}

export function DayPanel({ dayData, loading, izin, onAksi, onBuka, draggingItem, onDragStart, onDragEnd, onLepasMeja }) {
  if (!dayData) return <div className="h-40 animate-pulse rounded-card bg-inset" aria-busy="true" />;
  const total = dayData.stations.reduce((a, s) => a + s.items.length, 0) + dayData.tanpaMeja.length;
  const dragAktif = !!draggingItem;
  const bolehSeret = (it) => !!izin.jadwalkan && it.sumber === "ADMIN";
  return (
    <section aria-label={`Rincian ${labelTanggal(dayData.date)}`} data-testid="day-panel" className="min-w-0 space-y-2" aria-busy={loading || undefined}>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold text-ink">{labelHari(dayData.date)} <span className="font-normal text-ink3">· {total} unit</span></h2>
        <p className="m-0 flex items-center gap-1 text-[12px] text-ink3" data-testid="catatan-kapasitas"><Info size={12} aria-hidden /> {dayData.kapasitas.perMeja} unit per meja × {dayData.kapasitas.mejaCount} meja. Durasi kerja belum tersedia, jadi kapasitas dihitung dari jumlah unit.</p>
      </header>
      {total === 0 && <p className="m-0 rounded-card border border-dashed border-line px-3 py-3 text-[13px] text-ink3" data-testid="hari-kosong">Belum ada unit dijadwalkan pada hari ini. Pilih unit dari antrean lalu tekan Jadwalkan.</p>}
      <div className="space-y-2">
        {dayData.stations.map((s) => (
          <MejaBaris key={s.code} s={s} dragAktif={dragAktif && !!izin.jadwalkan} onLepasMeja={onLepasMeja}>
            {s.items.map((it) => <KartuUnit key={`${it.sumber}-${it.unitId}`} item={it} izin={izin} mode="hari" onAksi={onAksi} onBuka={onBuka} draggable={bolehSeret(it)} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
          </MejaBaris>
        ))}
        {dayData.tanpaMeja.length > 0 && (
          <section className="rounded-card border border-line bg-surface" data-testid="tanpa-meja">
            <h3 className="m-0 px-3 py-1.5 text-[13px] font-semibold text-ink">Tanpa meja <span className="font-normal text-ink3">· hanya tanggal, meja belum dipilih</span></h3>
            <div className="space-y-2 px-2 pb-2">{dayData.tanpaMeja.map((it) => <KartuUnit key={`${it.sumber}-${it.unitId}`} item={it} izin={izin} mode="hari" onAksi={onAksi} onBuka={onBuka} draggable={bolehSeret(it)} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}</div>
          </section>
        )}
      </div>
    </section>
  );
}
