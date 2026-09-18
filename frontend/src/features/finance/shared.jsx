import React, { useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";

// Potongan UI yang dipakai berulang di SELURUH workspace Finance.
// Dikumpulkan di satu file karena semuanya kecil dan selalu berpasangan —
// memecahnya jadi 8 file satu-komponen cuma menambah lompatan saat membaca.

// ─── UANG ────────────────────────────────────────────────────────────────
// SENGAJA TIDAK memakai formatRupiah() dari utils/format.js.
//
// Fungsi itu (`"Rp" + n.toLocaleString("id-ID")`) membulatkan ke rupiah utuh
// dan menampilkan tanda minus di depan angka. Untuk laporan keuangan dua hal
// itu salah: sen hasil alokasi/HPP rata-rata hilang tanpa jejak (dan totalnya
// jadi tidak cocok dengan jumlah barisnya), dan angka negatif di kolom
// keuangan Indonesia lazim ditulis dalam kurung. `formatRupiah` TETAP dipakai
// di seluruh CRM/Armada — di sana nominalnya memang Int rupiah bulat.
export function formatUang(n, { sen = false, kurung = true } = {}) {
  const v = Number(n) || 0;
  const negatif = v < 0;
  const abs = Math.abs(v);
  const teks = abs.toLocaleString("id-ID", {
    minimumFractionDigits: sen ? 2 : 0,
    maximumFractionDigits: sen ? 2 : 0,
  });
  if (!negatif) return `Rp${teks}`;
  return kurung ? `(Rp${teks})` : `-Rp${teks}`;
}

/** Angka uang di dalam tabel — tabular-nums + warna merah untuk negatif. */
export function Uang({ value, sen = false, className, nolSebagaiStrip = false }) {
  const v = Number(value) || 0;
  if (nolSebagaiStrip && v === 0) return <span className="text-ink3">—</span>;
  return (
    <span className={cn("tabular-nums", v < 0 && "text-red", className)}>
      {formatUang(v, { sen })}
    </span>
  );
}

// ─── CATATAN KEJUJURAN LAPORAN ──────────────────────────────────────────
// Ditampilkan di ATAS setiap laporan, bukan di catatan kaki. Angka finance
// yang belum lengkap sangat mudah dibaca sebagai fakta final — dan keputusan
// bisnis diambil dari situ. Blok ini yang mencegahnya.
export function CatatanLaporan({ catatan, className }) {
  if (!catatan?.pesan?.length) return null;
  return (
    <Card className={cn("bg-orangebg", className)}>
      <CardContent className="flex gap-3 py-4">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange" />
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] font-bold text-ink">Angka di halaman ini belum lengkap</p>
          {catatan.pesan.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-ink2">{p}</p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Blok penjelasan netral — dipakai untuk menerangkan aturan akuntansi di layar. */
export function Penjelasan({ children, className }) {
  return (
    <Card className={cn("bg-blue-50", className)}>
      <CardContent className="flex gap-3 py-3.5">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 text-[13px] leading-relaxed text-ink2">{children}</div>
      </CardContent>
    </Card>
  );
}

// ─── STATUS ──────────────────────────────────────────────────────────────
const VARIAN_STATUS = {
  DRAFT: "neutral",
  MENUNGGU_APPROVAL: "orange",
  DISETUJUI: "accent",
  DIBAYAR: "green",
  DIBAYAR_SEBAGIAN: "orange",
  LUNAS: "green",
  DITOLAK: "red",
  DIBATALKAN: "neutral",
  POSTED: "green",
  REVERSED: "red",
  OPEN: "green",
  CLOSED: "neutral",
  BELUM_COCOK: "orange",
  COCOK: "green",
  DIABAIKAN: "neutral",
  SELESAI: "green",
};

export const LABEL_STATUS = {
  DRAFT: "Draft",
  MENUNGGU_APPROVAL: "Menunggu Persetujuan",
  DISETUJUI: "Disetujui",
  DIBAYAR: "Dibayar",
  DIBAYAR_SEBAGIAN: "Dibayar Sebagian",
  LUNAS: "Lunas",
  DITOLAK: "Ditolak",
  DIBATALKAN: "Dibatalkan",
  POSTED: "Terposting",
  REVERSED: "Dibalik",
  OPEN: "Terbuka",
  CLOSED: "Ditutup",
  BELUM_COCOK: "Belum Cocok",
  COCOK: "Cocok",
  DIABAIKAN: "Diabaikan",
  SELESAI: "Selesai",
};

export function StatusBadge({ status, className }) {
  if (!status) return null;
  return (
    <Badge variant={VARIAN_STATUS[status] || "neutral"} className={className}>
      {LABEL_STATUS[status] || status}
    </Badge>
  );
}

export const LABEL_SUMBER_JURNAL = {
  MANUAL: "Jurnal Manual",
  SALDO_AWAL: "Saldo Awal",
  PEMBAYARAN_ORDER: "Pembayaran Order",
  PENGAKUAN_PENDAPATAN: "Pengakuan Pendapatan",
  REFUND: "Refund",
  PENGELUARAN: "Pengeluaran",
  PEMBELIAN: "Pembelian",
  BIAYA_KENDARAAN: "Biaya Kendaraan",
  BIAYA_IKLAN: "Belanja Iklan",
  PEMASUKAN_LAIN: "Pemasukan Lain",
  TRANSFER_KAS: "Transfer Kas",
  TAGIHAN_SUPPLIER: "Tagihan Supplier",
  PEMBAYARAN_SUPPLIER: "Pembayaran Supplier",
  PEMAKAIAN_BAHAN: "Pemakaian Bahan",
  PENERIMAAN_BAHAN: "Penerimaan Bahan",
  KASBON: "Kasbon",
  REVERSAL: "Jurnal Balik",
};

export const LABEL_DIVISI = {
  SALES: "Sales", PRODUKSI: "Produksi", GUDANG: "Gudang",
  DELIVERY: "Delivery", DIGITAL_TECHNOLOGY: "D&T (Digital & Technology)",
  OFFICE: "Office", MANAGEMENT: "Management", UMUM: "Umum",
};

export const LABEL_TIPE_AKUN = {
  ASET: "Aset", KEWAJIBAN: "Kewajiban", EKUITAS: "Ekuitas",
  PENDAPATAN: "Pendapatan", BEBAN_POKOK: "Beban Pokok", BEBAN: "Beban Operasional",
};

// ─── PEMILIH PERIODE ────────────────────────────────────────────────────
// Dua input tanggal polos, BUKAN DateRangePicker CRM. Laporan keuangan
// hampir selalu dibaca per BULAN KALENDER, dan tombol cepat di bawah yang
// mengerjakan 95% kasusnya; memaksa kalender rentang bebas di sini justru
// menambah klik untuk pekerjaan yang paling sering dilakukan.
export function PeriodePicker({ from, to, onChange, className }) {
  const preset = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const bulan = (offset) => {
      const awal = new Date(Date.UTC(y, m + offset, 1));
      const akhir = new Date(Date.UTC(y, m + offset + 1, 0));
      return { from: fmt(awal), to: fmt(akhir) };
    };
    return {
      bulanIni: bulan(0),
      bulanLalu: bulan(-1),
      tahunIni: { from: `${y}-01-01`, to: fmt(new Date(Date.UTC(y, 11, 31))) },
    };
  }, []);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <DateChip value={from} ariaLabel="Tanggal mulai" onChange={(v) => onChange({ from: v, to })} />
      <span className="text-ink3">—</span>
      <DateChip value={to} ariaLabel="Tanggal akhir" onChange={(v) => onChange({ from, to: v })} />
      <Button size="sm" variant="neutral" onClick={() => onChange(preset.bulanIni)}>Bulan Ini</Button>
      <Button size="sm" variant="neutral" onClick={() => onChange(preset.bulanLalu)}>Bulan Lalu</Button>
      <Button size="sm" variant="neutral" onClick={() => onChange(preset.tahunIni)}>Tahun Ini</Button>
    </div>
  );
}

/**
 * Tampilan pill untuk <input type="date"> — TETAP input native di baliknya
 * (transparan penuh, menutupi seluruh pill) supaya date-picker bawaan
 * OS/browser tetap yang dipakai, tidak menulis widget kalender sendiri.
 * Yang terlihat cuma ikon + teks terformat ("17 Sep 2026"), bukan
 * "mm/dd/yyyy" bawaan browser saat kosong.
 *
 * Diekspor (bukan cuma dipakai PeriodePicker) — 15 titik lain di halaman
 * finance pakai <Input type="date"> mentah untuk SATU tanggal (Tanggal
 * pengeluaran, Tanggal bayar, dst), bukan rentang. Pemanggil form tunggal
 * pakai `className="w-full"` supaya lebar sama dengan field lain di form.
 */
export function DateChip({ value, onChange, ariaLabel, className }) {
  return (
    <span className={cn("relative inline-flex h-9 items-center gap-1.5 rounded-full bg-accentbg px-3 text-[13px] font-medium text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40", className)}>
      <CalendarDays size={14} className="shrink-0 text-accent" aria-hidden="true" />
      <span className="tabular-nums">{value ? tanggalPendek(value) : "Pilih tanggal"}</span>
      <input
        type="date" value={value || ""} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/** Rentang default = bulan berjalan (WIB). Dipakai sebagai state awal halaman. */
export function periodeDefault() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = wib.getUTCMonth();
  const p = (n) => String(n).padStart(2, "0");
  const akhir = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${p(m + 1)}-01`, to: `${y}-${p(m + 1)}-${p(akhir)}` };
}

// ─── KERANGKA HALAMAN ───────────────────────────────────────────────────
// Bungkus seragam untuk loading/error supaya 12 halaman finance tidak
// masing-masing menulis ulang tiga cabang yang sama.
export function HalamanFinance({ title, subtitle, actions, loading, error, onRetry, children }) {
  return (
    <PageContainer>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <PageBody>
        {error ? (
          <Card>
            <CardContent className="py-10">
              <EmptyState
                icon={AlertTriangle}
                title="Gagal memuat data"
                description={error}
                action={onRetry ? <Button size="sm" onClick={onRetry}>Coba lagi</Button> : null}
              />
            </CardContent>
          </Card>
        ) : loading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-12 text-ink2">
              <Loader2 size={16} className="animate-spin" /> Memuat data keuangan…
            </CardContent>
          </Card>
        ) : (
          children
        )}
      </PageBody>
    </PageContainer>
  );
}

/**
 * Kartu angka ringkas — lebih padat dari KpiCard Laporan, muat 4-6 sebaris.
 *
 * `info` (opsional) — penjelasan singkat angka ini dalam bahasa manusia,
 * ditampilkan lewat ikon "i" (InfoTooltip) di sebelah label. Prinsipnya:
 * kalau seseorang yang BARU PERTAMA KALI melihat kartu ini bisa bingung
 * angkanya dihitung dari mana atau kenapa penting, kartunya WAJIB punya
 * `info` — bukan hiasan, ini pengganti training manual untuk tim yang baru
 * pindah dari pencatatan manual (Notion) ke sistem ini.
 */
export function KartuAngka({ label, value, sub, tone = "default", onClick, info }) {
  const isi = (
    <>
      <div className="flex items-center gap-1">
        <p className="text-[12px] font-medium text-ink3">{label}</p>
        {info && <InfoTooltip text={info} />}
      </div>
      <p className={cn(
        "mt-1.5 text-[20px] font-bold tabular-nums leading-tight",
        tone === "red" && "text-red",
        tone === "green" && "text-green",
        tone === "orange" && "text-orange"
      )}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[12px] text-ink3">{sub}</p>}
    </>
  );
  const kelas = cn(
    "rounded-card bg-surface p-4 shadow-card text-left",
    onClick && "transition-shadow hover:shadow-popover cursor-pointer",
    onClick && "outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
  );
  // `role="button"` di <div>, BUKAN <button> sungguhan — kartu ini hampir
  // selalu punya `info` (InfoTooltip, komponennya SENDIRI <button>), dan
  // <button> di dalam <button> itu markup TIDAK VALID (browser boleh
  // memperlakukan fokus/tap-nya secara tidak konsisten, terutama di HP).
  // Tetap bisa diklik & keyboard-accessible lewat tabIndex + onKeyDown.
  return onClick
    ? (
      <div
        role="button" tabIndex={0} className={kelas}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } }}
      >
        {isi}
      </div>
    )
    : <div className={kelas}>{isi}</div>;
}

/**
 * Header kartu berpasangan (judul + penjelasan singkat + ikon info opsional
 * untuk detail lebih dalam) — dipakai supaya SETIAP kartu isi (tabel,
 * daftar) di workspace Finance punya penjelasan yang konsisten posisinya,
 * bukan separuh kartu punya CardDescription dan separuh tidak.
 *
 * `description` = kalimat pendek yang SELALU terlihat (menjawab "kartu ini
 * isinya apa"). `info` (opsional) = detail tambahan yang baru tampil kalau
 * ikon "i" disentuh (menjawab "kenapa/bagaimana ini dihitung", biasanya
 * lebih teknis/panjang daripada yang pantas ditulis permanen di layar).
 */
export function JudulKartu({ title, description, info }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-1.5">
        {title}
        {info && <InfoTooltip text={info} />}
      </CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
  );
}

/**
 * Tombol aksi yang mengunci dirinya selama request berjalan.
 *
 * BUKAN kemewahan UI: seluruh aksi finance menulis ke buku besar, dan
 * double-click adalah cara paling gampang seseorang memposting dua kali.
 * Idempotensi di backend sudah mencegah jurnal dobel, tapi mencegahnya
 * sejak di jari lebih baik daripada mengandalkan penjaga terakhir.
 */
export function TombolAksi({ onClick, children, confirmText, ...props }) {
  const [sibuk, setSibuk] = useState(false);
  async function jalankan(e) {
    if (sibuk) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setSibuk(true);
    try {
      await onClick?.(e);
    } finally {
      setSibuk(false);
    }
  }
  return (
    <Button
      {...props}
      disabled={sibuk || props.disabled}
      onClick={jalankan}
      // Target sentuh 44px di HP (standar mobile project ini, lihat CLAUDE.md
      // §8) — ukuran Button bawaan (32-40px) di bawah itu. Cuma di layar
      // sempit (max-sm) supaya kepadatan desktop/tablet tidak berubah;
      // TombolAksi eksklusif dipakai Finance, jadi tidak menyentuh divisi lain.
      className={cn("max-sm:min-h-11 max-sm:px-4", props.className)}
    >
      {sibuk && <Loader2 size={14} className="animate-spin" />}
      {children}
    </Button>
  );
}

/** Input nominal rupiah — angka polos, rata kanan, tanpa pemisah saat diketik. */
export function InputUang({ value, onChange, className, ...props }) {
  return (
    <input
      type="number" inputMode="decimal" min="0" step="1"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink",
        "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
        className
      )}
      {...props}
    />
  );
}

/** <select> bergaya sama dengan Input — dipakai di banyak form finance. */
export function Pilihan({ value, onChange, children, className, ...props }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink",
        "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function tanggalPendek(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}

export function tanggalJam(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });
}
