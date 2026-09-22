import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, Camera, X, ShieldCheck, ClipboardPaste } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { useUrlBukti, LinkBukti } from "@/features/finance/receiptMedia.jsx";
import { compressImage } from "@/utils/compressImage.js";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { SIMPLE_PRESETS, makeRange, makeCustomRange, todayWIB } from "@/lib/dateRange.js";

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
  AKTIF: "orange",
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
  AKTIF: "Aktif",
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
// Memakai DateRangePicker CRM (preset + kalender 2 bulan, gaya Google Ads) —
// sebelumnya dua input tanggal polos + 3 tombol, dan owner minta seragam
// dengan Dashboard/Laporan Sales CRM (19 Sep 2026). Kontrak ke halaman
// finance TIDAK berubah: from/to "YYYY-MM-DD" + onChange({from,to}).
//
// Beda dengan CRM: TANPA "Bandingkan" (endpoint finance tidak punya periode
// pembanding), TANPA preset "Semua" (from/to kosong dibuang qsFinance jadi
// request tanpa rentang), dan tanggal masa depan boleh dipilih (jatuh tempo,
// jadwal) — batas atas 1 tahun ke depan, bukan hari ini.
export function PeriodePicker({ from, to, onChange, className }) {
  const value = useMemo(() => {
    for (const p of SIMPLE_PRESETS) {
      if (p.id === "all_time") continue;
      const r = p.resolve();
      if (r.from === from && r.to === to) return makeRange(p.id);
    }
    return makeCustomRange(from, to);
  }, [from, to]);
  const maxDate = useMemo(() => todayWIB().add(1, "year").format("YYYY-MM-DD"), []);

  return (
    <div className={className}>
      <DateRangePicker
        value={value} maxDate={maxDate} showCompare={false} allowAll={false}
        onChange={(r) => r?.from && r?.to && onChange({ from: r.from, to: r.to })}
      />
    </div>
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
// `fluid` (D-193) default TRUE di sini — HAMPIR SEMUA halaman Finance adalah
// halaman daftar/tabel padat (lihat audit lebar layar 22 Sep 2026). Halaman
// yang justru butuh lebar baca terbatas (kalau ada) mengirim `fluid={false}`.
export function HalamanFinance({ title, subtitle, actions, loading, error, onRetry, fluid = true, children }) {
  return (
    <PageContainer fluid={fluid}>
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

// ─── BUKTI / NOTA ────────────────────────────────────────────────────────
// Kebijakan lengkap: backend services/finance/receipts.js. Ringkasnya —
// nota WAJIB sebelum disetujui (pembelian, reimbursement, nominal di atas
// ambang), dan verifikasinya harus dilakukan ORANG LAIN (bukan pembuat).

/**
 * Kompres ringan di browser SEBELUM upload (hemat kuota HP, foto mentah 5–8 MB
 * jadi ratusan KB). Server tetap mengompres ulang sebagai jaminan — ini cuma
 * mempercepat upload. Gagal/kelamaan (mis. format HEIC yang tak bisa dibaca
 * browser) → kirim file aslinya, biar server yang memutuskan.
 */
async function siapkanFoto(file) {
  if (!file.type?.startsWith("image/") || file.size < 400 * 1024) return file;
  try {
    const kecil = await Promise.race([
      compressImage(file, 1600, 0.8),
      new Promise((res) => setTimeout(() => res(null), 8000)),
    ]);
    return kecil && kecil.size < file.size ? kecil : file;
  } catch {
    return file;
  }
}

// Thumbnail kecil (~20 KB) dibuat server berdampingan dengan foto utama
// (<hash>.jpg → <hash>_t.jpg) supaya tabel tidak memuat foto penuh. Foto lama
// tanpa thumbnail otomatis jatuh balik ke foto utama.
function Foto({ url, className, alt = "Nota" }) {
  const [pakaiAsli, setPakaiAsli] = useState(false);
  // Foto nota finance butuh URL bertanda-tangan (tidak lagi publik).
  const h = useUrlBukti(url);
  if (!h) return <span className={className} aria-hidden />;
  const src = pakaiAsli ? h.url : h.thumbUrl || h.url;
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setPakaiAsli(true)} />;
}

function peringatanDobel(dipakaiDi) {
  if (dipakaiDi?.length) {
    window.alert(`Perhatian: foto nota ini sudah dipakai di ${dipakaiDi.join(", ")}. Kalau satu nota memang mencakup dua catatan, abaikan — kalau bukan, kemungkinan nota terpakai dua kali.`);
  }
}

/** Ambil file gambar dari event tempel (Ctrl+V) atau seret-lepas; null kalau tidak ada. */
function gambarDariEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return null;
  for (const item of dt.items || []) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  for (const file of dt.files || []) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

/** Baca gambar dari clipboard lewat tombol (butuh izin browser & HTTPS). */
async function bacaGambarClipboard() {
  if (!navigator.clipboard?.read) {
    throw new Error("Browser ini tidak bisa membaca clipboard lewat tombol — klik kotak Bukti lalu tekan Ctrl+V");
  }
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("Izin membaca clipboard ditolak — klik kotak Bukti lalu tekan Ctrl+V");
  }
  for (const it of items) {
    const tipe = it.types.find((t) => t.startsWith("image/"));
    if (tipe) return new File([await it.getType(tipe)], "tempel.png", { type: tipe });
  }
  throw new Error("Tidak ada gambar di clipboard — di WhatsApp, klik kanan fotonya lalu pilih Salin gambar");
}

/**
 * Pemilih foto nota di dalam form. Tiga cara memasukkan foto:
 *  1. klik "Foto / unggah nota" (galeri/kamera),
 *  2. TEMPEL (Ctrl+V) — selama form terbuka, di mana pun kursor berada
 *     (alur utama: salin foto dari WhatsApp Web/Desktop lalu tempel),
 *  3. seret-lepas file ke kotak ini.
 */
export function PemilihBukti({ url, onChange }) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const [sorot, setSorot] = useState(false);

  async function proses(file) {
    setSibuk(true);
    setGalat("");
    try {
      const fd = new FormData();
      fd.append("receipt", await siapkanFoto(file));
      const r = await api.uploadFinanceReceipt(fd);
      onChange(r.url);
      peringatanDobel(r.dipakaiDi);
    } catch (err) {
      setGalat(err.message);
    } finally {
      setSibuk(false);
    }
  }

  // Tempel di level dokumen: form ini hanya ada selama modalnya terbuka, jadi
  // tidak bentrok dengan halaman lain. Hanya event yang MEMBAWA GAMBAR yang
  // diambil — tempel teks biasa ke kolom isian tidak terganggu.
  useEffect(() => {
    function saatTempel(e) {
      const file = gambarDariEvent(e);
      if (!file) return;
      e.preventDefault();
      proses(file);
    }
    document.addEventListener("paste", saatTempel);
    return () => document.removeEventListener("paste", saatTempel);
  });

  function pilih(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) proses(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setSorot(true); }}
      onDragLeave={() => setSorot(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSorot(false);
        const file = gambarDariEvent(e);
        if (file) proses(file);
      }}
      className={cn("rounded-lg border border-dashed p-2.5 transition-colors", sorot ? "border-accent bg-accentbg" : "border-line")}
    >
      <div className="flex flex-wrap items-center gap-2">
        {url && (
          <LinkBukti url={url} className="block h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line">
            <Foto url={url} className="h-full w-full object-cover" />
          </LinkBukti>
        )}
        <label className={cn(
          "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink2 transition-colors hover:border-accent hover:text-accent sm:h-9",
          sibuk && "pointer-events-none opacity-60"
        )}>
          {sibuk ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {url ? "Ganti foto" : "Foto / unggah nota"}
          <input type="file" accept="image/*" className="hidden" onChange={pilih} disabled={sibuk} />
        </label>
        {url && (
          <button type="button" onClick={() => onChange("")} className="inline-flex h-11 w-11 items-center justify-center text-ink3 hover:text-red sm:h-9 sm:w-9" title="Lepas foto">
            <X size={14} />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] text-ink3">
        Dari WhatsApp: klik kanan foto → <strong>Salin gambar</strong> → tekan <kbd className="rounded bg-inset px-1">Ctrl</kbd>+<kbd className="rounded bg-inset px-1">V</kbd> di sini. Bisa juga seret file ke kotak ini.
      </p>
      {galat && <p className="mt-1 text-[12px] text-red">{galat}</p>}
    </div>
  );
}

/**
 * Sel tabel "Bukti" untuk baris pengeluaran/pembelian yang SUDAH ada:
 * thumbnail + status verifikasi, atau — kalau belum ada nota — tombol Unggah,
 * tombol Tempel (dari clipboard), dan kotak yang menerima Ctrl+V saat difokus.
 * `aksi(fn)` = pembungkus halaman (jalankan → muat ulang → tampilkan galat).
 */
export function SelBukti({ doc, jenis, aksi }) {
  const tertutup = ["DIBATALKAN", "DITOLAK"].includes(doc.status);

  async function kirim(file) {
    await aksi(async () => {
      const fd = new FormData();
      fd.append("receipt", await siapkanFoto(file));
      const up = await api.uploadFinanceReceipt(fd);
      const r = await api.setFinanceReceipt(jenis, doc.id, up.url);
      peringatanDobel(r.dipakaiDi);
    });
  }

  if (!doc.receiptUrl) {
    if (tertutup) return <span className="text-ink3">—</span>;
    return (
      <div
        tabIndex={0}
        title="Klik kotak ini lalu tekan Ctrl+V untuk menempel foto"
        onPaste={(e) => {
          const file = gambarDariEvent(e);
          if (!file) return;
          e.preventDefault();
          kirim(file);
        }}
        className="flex items-center gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <label className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line px-2.5 text-[12px] text-ink2 hover:border-accent hover:text-accent sm:h-8">
          <Camera size={13} /> Unggah
          <input
            type="file" accept="image/*" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) kirim(file); }}
          />
        </label>
        <button
          type="button"
          onClick={() => aksi(async () => { await kirim(await bacaGambarClipboard()); })}
          className="inline-flex h-11 items-center gap-1 rounded-lg border border-dashed border-line px-2.5 text-[12px] text-ink2 hover:border-accent hover:text-accent sm:h-8"
          title="Tempel foto yang baru disalin (mis. dari WhatsApp)"
        >
          <ClipboardPaste size={13} /> Tempel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <LinkBukti url={doc.receiptUrl} className="block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line">
        <Foto url={doc.receiptUrl} className="h-full w-full object-cover" />
      </LinkBukti>
      {doc.receiptVerifiedAt ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-green"><ShieldCheck size={13} /> Terverifikasi</span>
      ) : tertutup ? null : (
        <TombolAksi size="sm" variant="neutral" onClick={() => aksi(() => api.verifyFinanceReceipt(jenis, doc.id))}>
          Verifikasi
        </TombolAksi>
      )}
    </div>
  );
}
