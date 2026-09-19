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
//
// BUG DIPERBAIKI (2 September 2026, laporan owner: "rute, jadwal penugasan
// [tidak] bisa dibuat untuk tanggal berapapun... besok, lusa, 1 minggu") —
// CalendarMonth (dipakai di dalam) DEFAULT membatasi tanggal maksimal ke
// HARI INI kalau `maxDate` tidak diberikan (cocok untuk DateRangePicker di
// Laporan, yang memang laporan masa lalu). DatePicker ini dipasang ulang di
// JobDetailDrawer (Tanggal job) & ArmadaRoutes/ArmadaDashboard/ArmadaJobs
// (semua butuh tanggal MASA DEPAN — job dijadwalkan ke depan, bukan cuma
// difilter ke belakang) TANPA meneruskan itu — jadi warisan default "cuma
// sampai hari ini" ikut kebawa ke tempat yang salah, tanggal besok/lusa
// tidak bisa diklik sama sekali. `allowFuture` (default true DI SINI,
// beda dari default CalendarMonth) membuka itu — dipakai eksplisit
// `allowFuture={false}` di tempat yang murni laporan historis (job/rute
// tidak pernah punya tanggal masa depan yang relevan ditampilkan di situ).
const MAKS_TANPA_BATAS = todayWIB().add(2, "year").format("YYYY-MM-DD");
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

// block / clearLabel (19 Sep 2026, form Finance): mode FIELD FORM — pemicu selebar
// kolom & setinggi input (h-9), bukan pill filter kecil; clearLabel mengganti
// "Hapus filter" (salah kata untuk field form).
export default function DatePicker({ value, onChange, placeholder = "Semua tanggal", className, allowFuture = true, block = false, clearLabel = "Hapus filter" }) {
  const [open, setOpen] = useState(false);
  // Posisi popover saat pemicu ada DI DALAM dialog/modal. Body modal
  // overflow-y-auto akan memotong popover `absolute` (kalender terpotong di
  // field yang dekat dasar modal). Solusi: `fixed` — dialog punya transform
  // (translate pusat), jadi containing block-nya ADALAH dialog, bukan viewport
  // — dan elemen yang containing block-nya leluhur dari container overflow
  // TIDAK ikut terpotong olehnya. Koordinat dihitung relatif kotak dialog.
  const [pos, setPos] = useState(null);
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
    const dlg = rootRef.current?.closest('[role="dialog"]');
    if (!dlg) { setPos(null); return; }
    const r = rootRef.current.getBoundingClientRect();
    const d = dlg.getBoundingClientRect();
    const TINGGI = 330, LEBAR = 264;
    const naik = r.bottom + 4 + TINGGI > window.innerHeight && r.top - TINGGI - 4 > 0;
    setPos({
      top: (naik ? r.top - TINGGI - 4 : r.bottom + 4) - d.top,
      left: Math.max(4, Math.min(r.left - d.left, d.width - LEBAR - 4)),
    });
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
          "flex items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150",
          block ? "h-9 w-full" : "h-8 max-w-[220px]",
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
          style={pos ? { top: pos.top, left: pos.left } : undefined}
          className={cn(
            // rounded-[12px], BUKAN rounded-xl: kombinasi `.rounded-xl.bg-surface` kena
            // aturan kaca (delivery-dark/-light.css, D-089) yang memaksa
            // `position: relative` (CSS tanpa @layer menang lawan utility fixed/
            // absolute) — popover jadi tidak lagi melayang di atas konten.
            "z-[1100] w-[264px] origin-top-left rounded-[12px] bg-surface p-3 shadow-popover",
            pos ? "fixed" : "absolute left-0 top-9",
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
            month={anchor} from={value || null} to={value || null} onPick={pilih}
            maxDate={allowFuture ? MAKS_TANPA_BATAS : undefined}
          />

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
                {clearLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
