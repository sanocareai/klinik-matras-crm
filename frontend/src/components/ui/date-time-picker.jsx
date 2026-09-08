import React, { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils.js";
import CalendarMonth from "./calendar-month.jsx";
import { todayWIB } from "@/lib/dateRange.js";

// ─── DATE-TIME PICKER (Sano DS v2, 8 September 2026) ─────────────────────────
// Menggantikan native <input type="datetime-local"> polos di "Waktu Selesai"
// (PodReviewDrawer.jsx & JobDetailDrawer.jsx — jalur Input Manual POD).
// Laporan owner: picker native browser tampil kaca-terangnya sendiri (bukan
// gelap Sano), pakai format AM/PM padahal operasional Sano Care 24 jam.
// Pola SAMA persis dengan DatePicker.jsx (kalender: reuse CalendarMonth,
// popover: bg-surface/shadow-popover/rounded-xl "kaca" yang sama dipakai
// SELURUH popover Delivery Hub) — cuma ditambah kolom Jam (2 daftar gulir
// 00-23/00-59, TANPA AM-PM sama sekali, bukan cuma diterjemahkan labelnya).
//
// value/onChange: string kontrak <input type="datetime-local"> —
// "YYYY-MM-DDTHH:mm" | "" — supaya SEMUA pemanggil lama (new Date(value),
// .toISOString()) tetap jalan tanpa ubah logic di luar komponen ini.
const MAKS_TANPA_BATAS = todayWIB().add(2, "year").format("YYYY-MM-DD");
const DELAY_MS = 150; // sama dengan DatePicker.jsx — 1 tempo animasi popover di seluruh Delivery Hub.
const JAM = Array.from({ length: 24 }, (_, i) => i);
const MENIT = Array.from({ length: 60 }, (_, i) => i);
const pad2 = (n) => String(n).padStart(2, "0");

// Kolom gulir satu angka (Jam ATAU Menit) — dipisah dari komponen utama
// supaya scrollIntoView per kolom independen (buka popover langsung
// tergulir ke jam/menit AKTIF, bukan mulai dari 00 tiap kali).
function KolomAngka({ label, values, active, onPick }) {
  const ref = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1">
      <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
      <div ref={ref} className="h-32 overflow-y-auto rounded-lg border border-line bg-inset/40 p-1">
        {values.map((v) => (
          <button
            key={v}
            ref={(el) => { itemRefs.current[v] = el; }}
            type="button"
            onClick={() => onPick(v)}
            className={cn(
              "block w-full rounded-md px-2 py-1 text-center text-[13px] font-semibold tabular-nums transition-colors",
              v === active ? "bg-accent text-white" : "text-ink2 hover:bg-hovertint"
            )}
          >
            {pad2(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DateTimePicker({ value, onChange, placeholder = "Pilih tanggal & jam", className, allowFuture = true }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const parsed = value ? dayjs(value) : null;
  const [anchor, setAnchor] = useState(() => (parsed || todayWIB()).startOf("month"));
  const rootRef = useRef(null);
  const active = !!value && parsed?.isValid();

  const tanggal = active ? parsed.format("YYYY-MM-DD") : null;
  const jam = active ? parsed.hour() : 0;
  const menit = active ? parsed.minute() : 0;

  // Ketik langsung (8 September 2026, laporan owner: "buat versi editable
  // tanpa harus pick dan scrolling jam... buat lebih simple" — skema
  // sebelumnya WAJIB klik lalu gulir daftar 00-23/00-59 untuk tiap angka,
  // lambat kalau jamnya jauh dari nilai sekarang mis. dari 08 ke 23).
  // Draft LOKAL (string, bukan angka) supaya user bisa mengetik "2" dulu
  // tanpa langsung dipaksa "02" di tengah mengetik — dikomit (clamp +
  // ubah()) saat blur/Enter, disinkronkan ulang dari jam/menit aktif tiap
  // popover dibuka supaya tidak nyangkut draft basi dari sesi sebelumnya.
  const [jamDraft, setJamDraft] = useState(() => pad2(jam));
  const [menitDraft, setMenitDraft] = useState(() => pad2(menit));

  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), DELAY_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (open) {
      setAnchor((parsed || todayWIB()).startOf("month"));
      setJamDraft(pad2(jam));
      setMenitDraft(pad2(menit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Set ulang salah satu bagian (tanggal/jam/menit) sambil mempertahankan
  // sisanya — belum ada tanggal terpilih -> "sekarang" jadi titik awal yang
  // masuk akal, sama pola dengan manualCompletedAt di pemanggil lama.
  function ubah({ tanggalBaru, jamBaru, menitBaru }) {
    const dasar = parsed && parsed.isValid() ? parsed : todayWIB();
    let d = tanggalBaru ? dayjs(tanggalBaru).hour(dasar.hour()).minute(dasar.minute()) : dasar;
    if (jamBaru !== undefined) d = d.hour(jamBaru);
    if (menitBaru !== undefined) d = d.minute(menitBaru);
    onChange(d.format("YYYY-MM-DDTHH:mm"));
  }

  // Komit draft ketik ke nilai sebenarnya — dipanggil saat blur/Enter,
  // BUKAN tiap keystroke (supaya "2" di tengah mengetik "23" tidak
  // langsung dipaksa jadi "02"). Kosong/di luar rentang -> balik ke nilai
  // aktif sekarang, bukan error yang mengganggu alur ketik cepat.
  function komitJam() {
    const n = Number(jamDraft);
    const v = Number.isInteger(n) && n >= 0 && n <= 23 ? n : jam;
    setJamDraft(pad2(v));
    if (v !== jam || !active) ubah({ jamBaru: v });
  }
  function komitMenit() {
    const n = Number(menitDraft);
    const v = Number.isInteger(n) && n >= 0 && n <= 59 ? n : menit;
    setMenitDraft(pad2(v));
    if (v !== menit || !active) ubah({ menitBaru: v });
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex h-9 w-full items-center gap-1.5 rounded-btn px-2.5 text-[12.5px] font-medium transition-colors duration-150",
          "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          active
            ? "border-accent/40 bg-accentbg text-accent"
            : "border-border bg-surface text-ink2 hover:border-accent/30"
        )}
      >
        <Calendar size={13} className="shrink-0" style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }} />
        <span className="min-w-0 flex-1 truncate text-left">
          {active ? `${parsed.format("D MMM YYYY")}, ${pad2(jam)}.${pad2(menit)}` : placeholder}
        </span>
        <ChevronDown size={13} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {mounted && (
        <div
          role="dialog"
          aria-label="Pilih tanggal & jam"
          aria-hidden={!open}
          className={cn(
            "absolute left-0 top-10 z-[1100] w-[300px] origin-top-left rounded-xl bg-surface p-3 shadow-popover",
            "duration-150 ease-out",
            open
              ? "animate-in fade-in-0 zoom-in-95"
              : "pointer-events-none animate-out fade-out-0 zoom-out-95"
          )}
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button" onClick={() => setAnchor((a) => a.subtract(1, "month"))}
              aria-label="Bulan sebelumnya" className="grid h-6 w-6 place-items-center rounded text-ink2 hover:bg-hovertint"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button" onClick={() => setAnchor((a) => a.add(1, "month"))}
              aria-label="Bulan berikutnya"
              disabled={!allowFuture && anchor.add(1, "month").isAfter(todayWIB().startOf("month"))}
              className="grid h-6 w-6 place-items-center rounded text-ink2 hover:bg-hovertint disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <CalendarMonth
            month={anchor} from={tanggal} to={tanggal}
            onPick={(s) => ubah({ tanggalBaru: s })}
            maxDate={allowFuture ? MAKS_TANPA_BATAS : undefined}
          />

          {/* Jam 24-JAM MURNI (8 September 2026, laporan owner — "sistem
              waktu 24jam") — TIDAK ADA kolom AM/PM sama sekali, beda dari
              picker native yang digantikan. */}
          <div className="mt-2.5 border-t border-line pt-2.5">
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ink3">
              <Clock size={11} aria-hidden /> Jam (24 jam)
            </p>

            {/* Ketik langsung (8 September 2026, laporan owner: "buat versi
                editable tanpa harus pick dan scrolling jam... lebih
                simple") — jalur UTAMA sekarang, cepat untuk jam yang jauh
                dari nilai sekarang. Daftar gulir di bawah TETAP ada untuk
                yang lebih suka klik, bukan dihapus — dua cara mengisi hal
                yang sama, bukan pengganti. */}
            <div className="mb-2 flex items-center justify-center gap-1.5">
              <input
                type="text" inputMode="numeric" maxLength={2}
                value={jamDraft}
                onChange={(e) => setJamDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
                onBlur={komitJam}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                onFocus={(e) => e.target.select()}
                aria-label="Jam (0-23)"
                className="h-10 w-14 rounded-lg border border-border bg-inset/40 text-center text-[18px] font-bold tabular-nums text-ink outline-none focus:border-accent"
              />
              <span className="text-[18px] font-bold text-ink3">:</span>
              <input
                type="text" inputMode="numeric" maxLength={2}
                value={menitDraft}
                onChange={(e) => setMenitDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
                onBlur={komitMenit}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                onFocus={(e) => e.target.select()}
                aria-label="Menit (0-59)"
                className="h-10 w-14 rounded-lg border border-border bg-inset/40 text-center text-[18px] font-bold tabular-nums text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="flex gap-2">
              <KolomAngka label="Jam" values={JAM} active={jam} onPick={(v) => { setJamDraft(pad2(v)); ubah({ jamBaru: v }); }} />
              <KolomAngka label="Menit" values={MENIT} active={menit} onPick={(v) => { setMenitDraft(pad2(v)); ubah({ menitBaru: v }); }} />
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => {
                const s = todayWIB();
                onChange(s.format("YYYY-MM-DDTHH:mm"));
                setJamDraft(pad2(s.hour()));
                setMenitDraft(pad2(s.minute()));
              }}
              className="text-[12px] font-semibold text-accent hover:underline"
            >
              Sekarang
            </button>
            {active && (
              <button
                type="button" onClick={() => { onChange(""); setOpen(false); }}
                className="text-[12px] text-ink3 hover:text-ink2 hover:underline"
              >
                Kosongkan
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
