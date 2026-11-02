import React, { useEffect, useRef } from "react";
import { AlertTriangle, Info, Target } from "lucide-react";
import KartuUnit from "@/features/production/rencana/KartuUnit.jsx";
import { labelHari, labelTanggal } from "@/features/production/rencana/rencanaModel.js";

// Kalender mingguan RINGKAS: satu sel per hari (kapasitas, terencana Admin/V2, target selesai, perlu perhatian). Hari/meja kosong tidak memakai panel besar.
// Klik hari = membuka rincian meja + daftar unit. Hari juga target lepas (seret) dan SEMUA tindakan tetap bisa lewat tombol/keyboard.
export function WeekStrip({ minggu, hari, onPilih, dragAktif, onLepas, loading, ringkas = false }) {
  const aktifRef = useRef(null);
  useEffect(() => { if (ringkas) aktifRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" }); }, [ringkas, hari, minggu?.start]);
  if (!minggu) return <div className={`${ringkas ? "h-[60px]" : "h-[92px]"} animate-pulse rounded-card bg-inset`} aria-busy="true" />;
  return (
    <div className="-mx-1 max-w-full min-w-0 overflow-x-auto px-1 pb-1" data-testid="week-strip" data-ringkas={ringkas ? "1" : "0"}>
      <ol className={`prod-rc-minggu m-0 grid list-none grid-cols-7 gap-2 p-0 ${ringkas ? "min-w-[500px]" : "min-w-[640px]"}`}>
        {minggu.days.map((d) => {
          const total = Math.max(minggu.kapasitas.total, 1); const libur = d.hariKerja === false;
          const pAdmin = Math.min((d.admin / total) * 100, 100); const pV2 = Math.min((d.v2 / total) * 100, 100 - pAdmin);
          const aktif = d.date === hari;
          const label = libur
            ? `${labelTanggal(d.date)}: libur, bukan hari kerja rutin${d.terencana ? `; ${d.terencana} unit terjadwal di luar hari kerja` : ""}`
            : `${labelTanggal(d.date)}: ${d.terencana} dari ${d.kapasitas} unit terencana${d.perhatian ? `, ${d.perhatian} perlu perhatian` : ""}${d.targetSelesai ? `, ${d.targetSelesai} target selesai` : ""}`;
          return (
            <li key={d.date}>
              <button
                ref={aktif ? aktifRef : null} type="button" aria-pressed={aktif} aria-label={label}
                data-testid="hari-sel" data-date={d.date} data-aktif={aktif ? "1" : "0"} data-penuh={d.penuh ? "1" : "0"} data-libur={libur ? "1" : "0"}
                onClick={() => onPilih(d.date)}
                onDragOver={dragAktif ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
                onDrop={dragAktif ? (e) => { e.preventDefault(); onLepas?.(d.date); } : undefined}
                className={`prod-rc-hari${ringkas ? " ringkas" : ""}${aktif ? " aktif" : ""}${libur ? " libur" : ""}${d.isPast ? " lewat" : ""}${dragAktif && !libur ? " sasaran" : ""}`}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${aktif ? "text-accent" : "text-ink3"}`}>{d.hari}{d.isToday ? (ringkas ? "" : " · hari ini") : ""}</span>
                  <span className="text-[15px] font-semibold text-ink">{Number(d.date.slice(8))}</span>
                </span>
                {libur ? (
                  <>
                    <span className="text-[12px] font-medium text-ink3">Libur</span>
                    {!ringkas && <span className={`text-[11px] ${d.terencana ? "text-orange" : "text-ink3"}`}>{d.terencana ? `${d.terencana} unit di luar hari kerja` : "Bukan hari kerja"}</span>}
                    {ringkas && d.terencana > 0 && <span className="text-[11px] text-orange">{d.terencana} di luar jam</span>}
                  </>
                ) : (
                  <>
                    <span className="flex items-center justify-between text-[12px]">
                      <span className={`font-semibold ${d.penuh ? "text-red" : "text-ink"}`}>{d.terencana}<span className="font-normal text-ink3">/{d.kapasitas}{ringkas ? "" : " unit"}</span></span>
                      {d.perhatian > 0 && <span className="inline-flex items-center gap-0.5 text-orange" title={`${d.perhatian} unit perlu perhatian`}><AlertTriangle size={12} aria-hidden />{d.perhatian}</span>}
                    </span>
                    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-inset" aria-hidden>
                      <span className="h-full bg-accent" style={{ width: `${pAdmin}%` }} /><span className="h-full bg-green" style={{ width: `${pV2}%` }} />
                    </span>
                    {!ringkas && (
                      <span className="flex items-center justify-between text-[11px] text-ink3">
                        <span>{d.admin ? `Admin ${d.admin}` : ""}{d.admin && d.v2 ? " · " : ""}{d.v2 ? `Berjalan ${d.v2}` : ""}{!d.admin && !d.v2 ? "Kosong" : ""}</span>
                        {d.targetSelesai > 0 && <span className="inline-flex items-center gap-0.5" title="Unit dengan target selesai pada hari ini"><Target size={11} aria-hidden />{d.targetSelesai}</span>}
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {loading && <span className="sr-only" role="status">Memuat minggu…</span>}
    </div>
  );
}

function MejaBaris({ s, dragAktif, onLepasMeja, children, menyimpan = false }) {
  const kosong = s.items.length === 0; const [atas, setAtas] = React.useState(false);
  return (
    <section
      className={`prod-rc-meja${kosong ? " kosong" : ""}${dragAktif ? " sasaran" : ""}${atas ? " atas" : ""}${s.capacity === 0 ? " libur" : ""}`}
      data-testid="meja-baris" data-meja={s.code} data-count={s.items.length} data-lepas={atas ? "1" : "0"} aria-busy={menyimpan || undefined}
      onDragOver={dragAktif ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setAtas(true); } : undefined} onDragLeave={dragAktif ? () => setAtas(false) : undefined} onDrop={dragAktif ? (e) => { e.preventDefault(); setAtas(false); onLepasMeja?.(s.code); } : undefined}
    >
      <header className="prod-rc-meja-kepala">
        <h3 className="m-0">{s.label} <span className={`font-normal ${s.capacity > 0 && s.items.length >= s.capacity ? "text-red" : "text-ink3"}`}>{s.capacity === 0 ? `· ${s.items.length} unit · tanpa kapasitas rutin (libur)` : `· ${s.items.length}/${s.capacity} unit`}</span></h3>
        {/* Petunjuk lepas MENGGANTIKAN teks PIC di baris yang sama: tinggi baris tidak berubah saat seret dimulai, sehingga sasaran tidak melompat di bawah pointer. */}
        {dragAktif
          ? <span className="min-w-0 text-[12px] font-medium text-accent" data-testid="meja-lepas-petunjuk">{s.capacity === 0 ? "Hari libur — tidak bisa dijadwalkan." : `Lepas di sini untuk menjadwalkan ${s.label}.`}</span>
          : <span className="min-w-0 text-[12px] text-ink3">{s.pic ? <>PIC {s.pic.nama}{s.pic.aktif === false ? " (nonaktif)" : ""}</> : "PIC belum ditetapkan"}{s.capacity === 0 ? "" : kosong ? ` · ${s.capacity} tempat kosong` : s.items.length < s.capacity ? ` · ${s.capacity - s.items.length} tempat kosong` : " · penuh"}</span>}
      </header>
      <div className="prod-rc-meja-isi">
        {children}
        {/* Slot kosong = sasaran lepas yang terlihat; kapasitas dari server (jumlah unit per meja), bukan jam. */}
        {s.capacity > 0 && Array.from({ length: Math.max(0, s.capacity - s.items.length) }).map((_, i) => <div key={`slot-${i}`} className="prod-rc-slot" data-testid="meja-slot" aria-hidden="true"><span>{dragAktif ? "Lepas di sini" : "Seret unit ke sini"}</span><small>atau pilih meja</small></div>)}
      </div>
    </section>
  );
}

export function DayPanel({ dayData, loading, izin, onAksi, onBuka, draggingItem, onDragStart, onDragEnd, onLepasMeja, pendingIds = new Set(), menyimpan = false }) {
  if (!dayData) return <div className="h-40 animate-pulse rounded-card bg-inset" aria-busy="true" />;
  const total = dayData.stations.reduce((a, s) => a + s.items.length, 0) + dayData.tanpaMeja.length;
  const dragAktif = !!draggingItem;
  const bolehSeret = (it) => !!izin.jadwalkan && it.sumber === "ADMIN";
  return (
    <section aria-label={`Rincian ${labelTanggal(dayData.date)}`} data-testid="day-panel" className="prod-rc-hari-panel min-w-0" aria-busy={loading || undefined}>
      <header className="prod-rc-hari-kepala">
        <h2 className="m-0">{labelHari(dayData.date)} <span>{total} unit terjadwal</span></h2>
        <p className="m-0 flex items-center gap-1 text-[12px] text-ink3" data-testid="catatan-kapasitas"><Info size={12} aria-hidden /> {dayData.kapasitas.perMeja} unit per meja × {dayData.kapasitas.mejaCount} meja (Sen–Sab; Minggu libur). Durasi kerja belum tersedia, jadi kapasitas dihitung dari jumlah unit.</p>
      </header>
      {dayData.libur && <p className="m-0 rounded-card bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="hari-libur" role="note">Hari Minggu libur — bukan hari kerja rutin, kapasitas rutin 0 dan Rencana Admin tidak bisa dijadwalkan di sini.{total > 0 ? " Unit di bawah terjadwal lewat jalur lain dan ditampilkan apa adanya." : ""}</p>}
      {total === 0 && <p className="m-0 rounded-card border border-dashed border-line px-3 py-3 text-[13px] text-ink3" data-testid="hari-kosong">Belum ada unit dijadwalkan pada hari ini. Seret unit dari antrean ke Meja 1–4, atau tekan Pilih meja pada kartu.</p>}
      <div className="prod-rc-meja-grid">
        {dayData.stations.map((s) => (
          <MejaBaris key={s.code} s={s} dragAktif={dragAktif && !!izin.jadwalkan} onLepasMeja={onLepasMeja} menyimpan={menyimpan}>
            {s.items.map((it) => <KartuUnit key={`${it.sumber}-${it.unitId}`} item={it} izin={izin} mode="hari" onAksi={onAksi} onBuka={onBuka} draggable={bolehSeret(it)} onDragStart={onDragStart} onDragEnd={onDragEnd} pending={pendingIds.has(it.unitId)} />)}
          </MejaBaris>
        ))}
        {dayData.tanpaMeja.length > 0 && (
          <section className="prod-rc-meja" data-testid="tanpa-meja">
            <header className="prod-rc-meja-kepala"><h3 className="m-0">Tanpa meja <span>· hanya tanggal, meja belum dipilih</span></h3></header>
            <div className="prod-rc-meja-isi">{dayData.tanpaMeja.map((it) => <KartuUnit key={`${it.sumber}-${it.unitId}`} item={it} izin={izin} mode="hari" onAksi={onAksi} onBuka={onBuka} draggable={bolehSeret(it)} onDragStart={onDragStart} onDragEnd={onDragEnd} pending={pendingIds.has(it.unitId)} />)}</div>
          </section>
        )}
      </div>
    </section>
  );
}
