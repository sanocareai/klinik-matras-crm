import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button } from "./ui/button.jsx";
import CalendarMonth from "./ui/calendar-month.jsx";
import {
  SIMPLE_PRESETS, PARAM_PRESETS, makeRange, makeCustomRange,
  previousPeriod, stepRange, canStep, formatRangeText, presetLabel, todayWIB,
} from "../lib/dateRange.js";

// ─── DATE RANGE PICKER — pola Google Ads ─────────────────────────────────────
// Kiri: daftar preset (+2 preset berparameter & toggle Bandingkan).
// Kanan: input tanggal mulai/akhir, navigasi bulan, kalender multi-bulan.
//
// Skema, preset, dan semua perhitungan tanggal ada di lib/dateRange.js —
// komponen ini SENGAJA tidak menghitung tanggal sendiri.
//
// PENTING — DRAFT + TERAPKAN: perubahan di dalam panel ditahan di state lokal
// dan baru dikirim lewat onChange saat "Terapkan" diklik. Tanpa ini, memilih
// rentang 2 klik akan memicu refetch di tengah pemilihan (Laporan menembak 6
// endpoint tiap perubahan range) — mahal dan bikin angka berkedip.
//
// Props: value: DateRange, onChange: (DateRange) => void
export default function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hover, setHover] = useState(null);
  // Tanggal 1 sudah dipilih, menunggu tanggal ke-2.
  const [picking, setPicking] = useState(false);
  const [anchor, setAnchor] = useState(() => todayWIB().subtract(1, "month"));
  const rootRef = useRef(null);

  // Sinkron ulang draft tiap panel dibuka — kalau ditutup pakai Batal, draft
  // yang lama tidak boleh nyangkut ke sesi berikutnya.
  useEffect(() => {
    if (open) {
      setDraft(value);
      setPicking(false);
      setHover(null);
      const dasar = value?.to ? dayjs(value.to) : todayWIB();
      setAnchor(dasar.startOf("month").subtract(1, "month"));
    }
  }, [open, value]);

  // Tutup dengan Esc / klik di luar.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const bulanTampil = useMemo(() => [anchor, anchor.add(1, "month")], [anchor]);
  const pembanding = draft?.compare ? previousPeriod(draft) : null;

  function pilihPreset(id, n) {
    setDraft(makeRange(id, { n: n ?? draft?.n ?? 30, compare: draft?.compare }));
    setPicking(false);
    setHover(null);
  }

  // Klik kalender: klik pertama menetapkan awal, klik kedua menetapkan akhir.
  function pilihTanggal(s) {
    if (!picking) {
      setDraft(makeCustomRange(s, null, { compare: draft?.compare }));
      setPicking(true);
      setHover(null);
    } else {
      setDraft(makeCustomRange(draft.from, s, { compare: draft?.compare }));
      setPicking(false);
      setHover(null);
    }
  }

  function terapkan() {
    // Kalau user berhenti di tengah (baru 1 tanggal), jadikan 1 hari saja
    // daripada mengirim rentang setengah jadi yang bikin backend abai filter.
    const siap = draft?.from && !draft?.to
      ? makeCustomRange(draft.from, draft.from, { compare: draft.compare })
      : draft;
    onChange(siap);
    setOpen(false);
  }

  function geser(dir) {
    if (!canStep(value)) return;
    onChange(stepRange(value, dir));
  }

  const inputCls = "h-8 w-full rounded px-2 text-[12px] tabular-nums text-ink " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      {/* Pemicu — meniru Google Ads: label preset + teks rentang + caret */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          // DS v2: pemicu tanpa border — permukaan terisi (bg-inset), dan
          // saat panel terbuka ditandai tint accent, bukan garis biru.
          "flex h-9 items-center gap-2 rounded-btn px-3 text-left transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          open ? "bg-accentbg" : "bg-inset hover:bg-hovertint"
        )}
      >
        <Calendar size={14} className="shrink-0 text-ink3" />
        <span className="text-[11px] font-medium text-ink3">{presetLabel(value)}</span>
        <span className="text-[13px] font-semibold tabular-nums text-ink">{formatRangeText(value)}</span>
        <ChevronDown size={14} className={cn("shrink-0 text-ink3 transition-transform", open && "rotate-180")} />
      </button>

      {/* ‹ › geser periode — dinonaktifkan untuk "Semua" (tidak ada panjang) */}
      <button
        type="button" onClick={() => geser(-1)} disabled={!canStep(value)}
        aria-label="Periode sebelumnya"
        className="grid h-8 w-7 place-items-center rounded-lg bg-surface text-ink2 transition-colors hover:bg-hovertint disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft size={15} />
      </button>
      <button
        type="button" onClick={() => geser(1)} disabled={!canStep(value)}
        aria-label="Periode berikutnya"
        className="grid h-8 w-7 place-items-center rounded-lg bg-surface text-ink2 transition-colors hover:bg-hovertint disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight size={15} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pilih rentang tanggal"
          className="absolute right-0 top-11 z-50 flex w-[min(92vw,620px)] flex-col overflow-hidden rounded-2xl bg-surface shadow-popover sm:flex-row"
        >
          {/* ── KIRI: preset ── */}
          <div className="flex max-h-[62vh] shrink-0 flex-col overflow-y-auto border-line sm:max-h-[440px] sm:w-[210px] sm:border-r">
            <button
              type="button"
              onClick={() => { setDraft({ ...draft, preset: "custom" }); setPicking(false); }}
              className={cn(
                "px-4 py-2 text-left text-[13px] transition-colors",
                draft?.preset === "custom" ? "bg-accentbg font-semibold text-accent" : "text-ink2 hover:bg-hovertint"
              )}
            >
              Kustom
            </button>
            <div className="my-1 border-t border-line" />

            {SIMPLE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pilihPreset(p.id)}
                className={cn(
                  "px-4 py-2 text-left text-[13px] transition-colors",
                  draft?.preset === p.id ? "bg-accentbg font-semibold text-accent" : "text-ink2 hover:bg-hovertint"
                )}
              >
                {p.label}
              </button>
            ))}

            {/* Preset berparameter — kotak angka + label, seperti Google Ads */}
            <div className="mt-1 flex flex-col gap-1.5 border-t border-line px-3 py-2.5">
              {PARAM_PRESETS.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <input
                    type="number" min="1" max="365"
                    value={draft?.preset === p.id ? (draft.n ?? 30) : (draft?.n ?? 30)}
                    onChange={(e) => pilihPreset(p.id, Math.max(1, Number(e.target.value) || 1))}
                    className="h-7 w-12 rounded px-1.5 text-center text-[12px] tabular-nums focus-visible:outline-none"
                    aria-label={p.label}
                  />
                  <button
                    type="button"
                    onClick={() => pilihPreset(p.id)}
                    className={cn(
                      "flex-1 text-left text-[12px] transition-colors",
                      draft?.preset === p.id ? "font-semibold text-accent" : "text-ink2 hover:text-ink"
                    )}
                  >
                    {p.label}
                  </button>
                </div>
              ))}
            </div>

            {/* Bandingkan — mengontrol TAMPILAN pembanding periode sebelumnya
                yang backend memang sudah hitung (growth %), bukan mengirim
                rentang kedua. Lihat catatan di lib/dateRange.js. */}
            <label className="mt-auto flex cursor-pointer items-center justify-between gap-2 border-t border-line px-4 py-3">
              <span className="text-[13px] text-ink2">Bandingkan</span>
              <span className="relative inline-flex">
                <input
                  type="checkbox" className="peer sr-only"
                  checked={!!draft?.compare}
                  onChange={(e) => setDraft({ ...draft, compare: e.target.checked })}
                />
                <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
                <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
          </div>

          {/* ── KANAN: input + kalender ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-end gap-2 border-b border-line px-3.5 py-3">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[10px] font-medium text-ink3">Tanggal mulai*</span>
                <input
                  type="date" className={inputCls}
                  value={draft?.from || ""}
                  max={todayWIB().format("YYYY-MM-DD")}
                  onChange={(e) => setDraft(makeCustomRange(e.target.value, draft?.to, { compare: draft?.compare }))}
                />
              </label>
              <span className="pb-2 text-ink3">–</span>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[10px] font-medium text-ink3">Tanggal akhir*</span>
                <input
                  type="date" className={inputCls}
                  value={draft?.to || ""}
                  max={todayWIB().format("YYYY-MM-DD")}
                  onChange={(e) => setDraft(makeCustomRange(draft?.from, e.target.value, { compare: draft?.compare }))}
                />
              </label>
            </div>

            {/* Navigasi geser 2 bulan yang ditampilkan bersamaan. BUG YANG
                DIPERBAIKI: baris ini SEBELUMNYA juga menampilkan label bulan
                sendiri (mis. "JUN 2026") DI ATAS grid — padahal tiap
                CalendarMonth di bawah SUDAH menampilkan label bulannya
                masing-masing ("JUN 2026" & "JUL 2026"). Hasilnya 3 label
                bulan berjejer (1 di sini + 2 di kalender), dan yang di sini
                cuma mewakili bulan KIRI jadi terasa salah/tidak nyambung
                dengan kalender KANAN. Sekarang cuma panah geser, tanpa teks
                — label bulan satu-satunya sumber kebenaran ada di tiap
                CalendarMonth. */}
            <div className="flex items-center justify-end gap-1 px-3.5 py-2">
              <button
                type="button" onClick={() => setAnchor((a) => a.subtract(1, "month"))}
                aria-label="Bulan sebelumnya"
                className="grid h-6 w-6 place-items-center rounded text-ink2 hover:bg-hovertint"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => setAnchor((a) => a.add(1, "month"))}
                disabled={anchor.add(1, "month").isAfter(todayWIB().startOf("month"))}
                aria-label="Bulan berikutnya"
                className="grid h-6 w-6 place-items-center rounded text-ink2 hover:bg-hovertint disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <div
              className="grid grid-cols-1 gap-4 overflow-y-auto px-3.5 pb-3 sm:grid-cols-2"
              onMouseLeave={() => setHover(null)}
            >
              {bulanTampil.map((m) => (
                <CalendarMonth
                  key={m.format("YYYY-MM")}
                  month={m}
                  from={draft?.from} to={draft?.to}
                  hover={picking ? hover : null}
                  onPick={pilihTanggal}
                  // Pratinjau rentang saat menunggu tanggal ke-2.
                  onHoverDate={picking ? setHover : undefined}
                />
              ))}
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5">
              <span className="min-w-0 truncate text-[11px] text-ink3">
                {pembanding
                  ? `vs ${formatRangeText({ ...pembanding })}`
                  : picking ? "Pilih tanggal akhir" : formatRangeText(draft)}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Batal</Button>
                <Button size="sm" onClick={terapkan} disabled={!draft?.from && draft?.preset !== "all_time"}>
                  Terapkan
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
