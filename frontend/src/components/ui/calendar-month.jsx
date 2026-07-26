import React from "react";
import dayjs from "dayjs";
import { cn } from "@/lib/utils.js";
import { todayWIB } from "@/lib/dateRange.js";

// Header hari: MINGGU dulu (M S S R K J S) — Minggu, Senin, Selasa, Rabu,
// Kamis, Jumat, Sabtu. Sesuai date picker Google Ads versi Indonesia.
const HARI = ["M", "S", "S", "R", "K", "J", "S"];
const BULAN_ID = [
  "JAN", "FEB", "MAR", "APR", "MEI", "JUN",
  "JUL", "AGU", "SEP", "OKT", "NOV", "DES",
];

// Grid satu bulan untuk pemilihan RENTANG.
// Props:
//   month     dayjs — bulan mana pun (dinormalisasi ke awal bulan)
//   from,to   "YYYY-MM-DD" | null — rentang terpilih
//   hover     "YYYY-MM-DD" | null — pratinjau saat memilih tanggal kedua
//   maxDate   "YYYY-MM-DD" — tanggal setelah ini dinonaktifkan (default: hari ini WIB;
//             tanggal masa depan tidak punya data, jadi tidak ada gunanya dipilih)
//   onPick(dateStr)
export default function CalendarMonth({ month, from, to, hover, maxDate, onPick, onHoverDate }) {
  const awal = month.startOf("month");
  const jumlahHari = awal.daysInMonth();
  // Berapa sel kosong sebelum tanggal 1 — day() 0=Minggu, cocok dgn urutan HARI.
  const offset = awal.day();
  const batas = maxDate || todayWIB().format("YYYY-MM-DD");

  // Saat memilih tanggal kedua, `hover` dipakai sebagai ujung sementara supaya
  // rentang ter-highlight mengikuti kursor (perilaku Google Ads).
  const ujung = to || hover;
  const lo = from && ujung ? (from <= ujung ? from : ujung) : from;
  const hi = from && ujung ? (from <= ujung ? ujung : from) : null;

  const sel = [];
  for (let i = 0; i < offset; i++) sel.push(null);
  for (let d = 1; d <= jumlahHari; d++) sel.push(awal.date(d));

  return (
    <div className="select-none">
      <p className="mb-1.5 px-1 text-[11px] font-bold tracking-wide text-ink2">
        {BULAN_ID[awal.month()]} {awal.year()}
      </p>

      <div className="grid grid-cols-7 gap-y-0.5">
        {HARI.map((h, i) => (
          <div key={i} className="pb-1 text-center text-[10px] font-semibold text-ink3">{h}</div>
        ))}

        {sel.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const s = d.format("YYYY-MM-DD");
          const disabled  = s > batas;
          const isFrom    = lo && s === lo;
          const isTo      = hi && s === hi;
          const inRange   = lo && hi && s > lo && s < hi;
          const isToday   = s === todayWIB().format("YYYY-MM-DD");
          const isEdge    = isFrom || isTo;

          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              onMouseEnter={() => onHoverDate?.(s)}
              aria-label={s}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "relative h-7 text-[12px] tabular-nums transition-colors duration-100",
                // Ujung rentang: sudut membulat hanya di sisi luar, supaya
                // rentang terlihat menyambung seperti satu batang.
                isEdge && "bg-accent font-bold text-white",
                isFrom && !isTo && "rounded-l-full",
                isTo && !isFrom && "rounded-r-full",
                isFrom && isTo && "rounded-full",
                inRange && "bg-accentbg text-accent",
                !isEdge && !inRange && !disabled && "rounded-full text-ink2 hover:bg-hovertint",
                disabled && "cursor-not-allowed text-ink3/40",
                isToday && !isEdge && "font-bold text-accent"
              )}
            >
              {d.date()}
              {/* Titik penanda "hari ini" — informasi tidak hanya lewat warna. */}
              {isToday && !isEdge && (
                <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { BULAN_ID };
