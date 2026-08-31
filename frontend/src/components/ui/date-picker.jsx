import React, { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.js";
import CalendarMonth from "./calendar-month.jsx";
import { todayWIB } from "@/lib/dateRange.js";
import { formatTanggal } from "@/utils/formatDate.js";

// ─── DATE PICKER (Sano DS v2) — filter tanggal TUNGGAL ───────────────────────
// Menggantikan native <input type="date"> polos di filter bar Delivery &
// Fulfillment (31 Agustus 2026, laporan owner: tampil "mm/dd/yyyy" gaya
// browser + dua <select> abu-abu identik di sebelahnya, terlihat "jelek
// banget" dibanding filter CRM yang sudah dirapikan D-030 lewat
// FilterDropdown, lihat filter-dropdown.jsx). Trigger visualnya SENGAJA
// disamakan persis dengan FilterDropdown — pill, ukuran, warna aktif/nonaktif
// sama — supaya baris tanggal+status+driver terasa SATU keluarga komponen,
// bukan tiga gaya berbeda ditumpuk berdampingan seperti sebelumnya.
//
// Kalendernya reuse CalendarMonth (komponen SAMA yang dipakai DateRangePicker
// di Laporan/Dashboard) — cukup 1 bulan, pilih tunggal (from=to=tanggal yang
// sama, CalendarMonth sudah menangani kasus itu sebagai "isSingleDay").
//
// value: "YYYY-MM-DD" | "" — string kosong = tidak ada filter ("Semua tanggal").
// Animasi buka SEKALIGUS tutup (31 Agustus 2026, laporan owner: perpindahan
// "sangat patah"). Popover ini BUKAN Radix (dibangun manual — CalendarMonth
// butuh konten bebas, bukan daftar MenuItem), jadi tidak otomatis dapat
// Presence: React biasanya melepas elemen dari DOM SEKETIKA `open` jadi
// false, sebelum sempat memutar animasi keluar sama sekali (persis gejala
// "patah" yang dilaporkan). DELAY_MS menahan elemen tetap ter-mount selama
// durasi animasi keluar (samakan dengan durasi kelas animate-out di bawah)
// sebelum benar-benar dilepas — dipakai juga untuk animasi status/driver
// (Menu.jsx, Radix DropdownMenu, dapat Presence otomatis dan SUDAH diperbaiki
// terpisah di sana) supaya ketiga filter terasa satu tempo yang sama.
const DELAY_MS = 150;

export default function DatePicker({ value, onChange, placeholder = "Semua tanggal", className }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [anchor, setAnchor] = useState(() => (value ? dayjs(value) : todayWIB()).startOf("month"));
  const rootRef = useRef(null);
  const active = !!value;

  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), DELAY_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Sinkron bulan yang ditampilkan tiap kali popover dibuka — supaya buka-
  // tutup-buka lagi selalu mulai dari bulan tanggal terpilih, bukan nyangkut
  // di bulan yang sempat digeser sesi sebelumnya.
  useEffect(() => {
    if (open) setAnchor((value ? dayjs(value) : todayWIB()).startOf("month"));
  }, [open, value]);

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

  function pilih(s) {
    onChange(s || "");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150",
          "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          active
            ? "border-accent/40 bg-accentbg text-accent"
            : "border-line bg-surface text-ink2 hover:border-accent/30"
        )}
      >
        <Calendar size={13} className="shrink-0" style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }} />
        <span className="min-w-0 flex-1 truncate text-left">{active ? formatTanggal(value) : placeholder}</span>
        <ChevronDown size={13} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {mounted && (
        <div
          role="dialog"
          aria-label="Pilih tanggal"
          aria-hidden={!open}
          className={cn(
            "absolute left-0 top-9 z-[1100] w-[264px] origin-top-left rounded-xl bg-surface p-3 shadow-popover",
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
              aria-label="Bulan berikutnya" className="grid h-6 w-6 place-items-center rounded text-ink2 hover:bg-hovertint"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <CalendarMonth month={anchor} from={value || null} to={value || null} onPick={pilih} />

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <button
              type="button" onClick={() => pilih(todayWIB().format("YYYY-MM-DD"))}
              className="text-[12px] font-semibold text-accent hover:underline"
            >
              Hari ini
            </button>
            {active && (
              <button
                type="button" onClick={() => pilih("")}
                className="text-[12px] text-ink3 hover:text-ink2 hover:underline"
              >
                Hapus filter
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
