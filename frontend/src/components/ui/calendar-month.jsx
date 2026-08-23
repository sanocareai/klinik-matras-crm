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
          // Fill rentang belah dua (isEdge tunggal) menyambung ke satu arah
          // saja, bukan penuh — separuh lain milik lingkaran indikatornya.
          const isSingleDay = isFrom && isTo;

          return (
            // BUG (fix, 22 Agustus 2026): sebelumnya rounded-full dipasang
            // LANGSUNG di <button> tanpa lebar tetap — di dalam grid-cols-7,
            // button lebar-otomatis (cuma sebesar teks angkanya) sementara
            // tinggi dipatok h-7, jadi "lingkaran" sebenarnya ELIPS gepeng
            // dan tidak center di sel. Untuk rentang, bar bg-accentbg tengah
            // juga tidak pernah benar-benar MENYAMBUNG antar sel karena
            // lebarnya ikut teks, bukan lebar sel. Pola dua lapis di bawah
            // (standar date-range picker: bar isian selebar SEL PENUH di
            // belakang, indikator lingkaran ukuran tetap di depan) memisahkan
            // dua tanggung jawab itu — bar boleh selebar apa pun sel-nya,
            // lingkaran selalu w-7 h-7 (persegi asli, bukan turunan grid).
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              onMouseEnter={() => onHoverDate?.(s)}
              aria-label={s}
              aria-current={isToday ? "date" : undefined}
              className="group relative h-8 w-full"
            >
              {!isSingleDay && (inRange || isEdge) && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0.5 bg-accentbg",
                    isFrom && !isTo && "left-1/2 right-0",
                    isTo && !isFrom && "left-0 right-1/2",
                    inRange && "left-0 right-0"
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-[1] mx-auto flex h-7 w-7 items-center justify-center rounded-full",
                  "text-[12px] tabular-nums transition-colors duration-100",
                  isEdge && "bg-accent font-bold text-white",
                  inRange && !isEdge && "text-accent",
                  !isEdge && !inRange && !disabled && "text-ink2 group-hover:bg-hovertint",
                  disabled && "cursor-not-allowed text-ink3/40",
                  isToday && !isEdge && "font-bold text-accent"
                )}
              >
                {d.date()}
              </span>
              {/* Titik penanda "hari ini" — informasi tidak hanya lewat warna. */}
              {isToday && !isEdge && (
                <span className="absolute bottom-0 left-1/2 z-[1] h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { BULAN_ID };
