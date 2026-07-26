# Sano DS v2 — Redesign minimalis (Apple-style) + Dark Mode

Catatan migrasi. Presentasi saja — **tidak ada** perubahan business logic,
panggilan API, atau bentuk data. Seluruh copy Bahasa Indonesia dipertahankan.

---

## 1. Ringkasan perubahan arsitektur

Hierarki sebelumnya dibawa oleh **border 1px** di setiap permukaan. Sekarang
dibawa oleh **tone permukaan + spacing + satu shadow lembut**.

| Aspek | Sebelum | Sesudah |
|---|---|---|
| Pemisah permukaan | border 1px di semua card | tone (`base` → `surface` → `inset`) + `--shadow-card` |
| Warna dekoratif | 6 hue (brand, violet, indigo, amber, emerald, rose) | **1 accent** + 3 semantik (red/orange/green) |
| Tangga tipe | ad-hoc (11–34px campur) | **5 langkah** + 1 ukuran metrik |
| Tema | hanya terang | Terang / Gelap / Sistem |
| Font UI | Geist | font sistem (`-apple-system`, SF Pro Text) |

---

## 2. File BARU

| File | Isi |
|---|---|
| `src/styles/tokens.css` | Seluruh token DS v2, blok `[data-theme="dark"]`, tangga tipe, jembatan token legacy, sweep border CSS legacy |
| `src/lib/ThemeProvider.jsx` | Context tema (light/dark/system), persist localStorage, ikut OS live |
| `src/features/settings/AppearanceSection.jsx` | Pengaturan → **Tampilan**: segmented control 3 opsi + pratinjau live |
| `src/components/ui/divider.jsx` | `Divider` (hairline inset) + `DividedList` |
| `src/components/ui/surface.jsx` | `POPOVER_SURFACE` / `OVERLAY` / `POPOVER_ITEM` — satu-satunya elevasi berat |

## 3. File DIUBAH (inti)

| File | Perubahan |
|---|---|
| `index.html` | Script blocking anti-kedip tema + `theme-color` mengikuti tema |
| `main.jsx` | `tokens.css` di-import **paling akhir**; `<ThemeProvider>` membungkus `<App/>` |
| `styles/tailwind.css` | Blok `@theme inline` DS v2; `--font-sans` → font sistem |
| `ui/card.jsx` | Tanpa border, `p-6`, `rounded-card`; **`CardInset` baru**; `hero` = sama dgn default |
| `ui/button.jsx` | 3 tingkat (primary/secondary/tertiary) + `neutral`, tanpa border |
| `ui/badge.jsx` | Teks semantik di atas latar 10% hue yang sama, tanpa border |
| `ui/progress.jsx` | Tinggi 4px, bulat penuh, track `--hairline`, fill `--accent` |
| `ui/modal.jsx` | `POPOVER_SURFACE` (translucent + blur 20px), border dihapus |
| `pages/Dashboard.jsx` | Container "Sano Intelligence" dihapus (−2 tingkat nesting) |
| `dashboard/HeroMetricCard.jsx` | Isian navy dihapus — angka yang membawa emphasis |
| `dashboard/AIRecommendations.jsx` | 1 Card + baris hairline; aksi tertiary; dismiss muncul saat hover |
| `dashboard/FollowUpTasks.jsx` | Waktu tunggu **relatif** ("25 hari", bukan "615 jam 9 mnt"); merah hanya untuk `critical` |
| `dashboard/TeamHealth.jsx` | Progress selalu accent; persentase rata kanan `tabular-nums` |
| `laporan/KpiCard.jsx` | Gradient navy hero dihapus |
| `utils/format.js` | **`formatDurasiRelatif()`** baru |

**Sweep otomatis:** 43 file / 530 substitusi (putaran 1) + 24 file / 30 (putaran 2)
+ 50 hex → token. Hasil audit akhir: **0** border dekoratif, **0** hue terlarang,
**0** `brand-*`, **0** gradient dekoratif di JSX.

---

## 4. Keputusan yang perlu diketahui

1. **`tokens.css` di-import PALING AKHIR — disengaja.** Beberapa nama token
   sengaja bertabrakan dengan `:root` lama di `index.css` (`--bg-base`,
   `--text-primary`, `--text-secondary`, `--shadow-card`). Karena terakhir,
   nilai DS v2 menang → **~3.000 baris CSS lama ikut palet baru + dark mode
   tanpa ditulis ulang.** Jangan pindahkan import ini ke atas.

2. **`@theme inline`, bukan `@theme`.** Bentuk `inline` menghasilkan
   `var(--token)` di utility-nya sehingga ikut `[data-theme]`. `@theme` biasa
   akan MENYALIN nilai light dan dark mode tidak akan pernah jalan — kegagalan
   yang tidak terlihat sampai seseorang menyalakan mode gelap.

3. **Border legacy dimatikan lewat daftar selektor eksplisit**, bukan
   `* { border: none }`. Alasannya: `border-top`/`bottom` pada baris list, sel
   tabel, dan tab adalah hairline yang MEMANG diinginkan spec.

4. **Font Geist dilepas** sesuai spec (font sistem). Paket
   `@fontsource-variable/geist*` masih terpasang & masih di-import di
   `main.jsx` untuk **Geist Mono** (angka/data). Kalau mono juga mau dilepas,
   hapus import-nya dan uninstall paketnya.

5. **Progress bar & stage pipeline tidak lagi berwarna per-status.** Progress ke
   target itu kuantitas, bukan peringatan; mewarnai merah/oranye setiap kali di
   bawah target membuat dashboard "alarm" terus dan warna semantik kehilangan
   arti. Hanya WON/LOST yang tetap semantik.

6. **Merah dibatasi.** `FollowUpTasks` dulu merah untuk semua yang >60 menit —
   pada data nyata hampir semua baris merah. Sekarang merah hanya untuk
   `severity: critical` (≥24 jam) dari backend.

---

## 5. ⚠️ Perlu review manual

| Item | Alasan |
|---|---|
| **Verifikasi visual browser** | Build bersih & audit 0 pelanggaran, tapi belum ada satu pun screenshot. Reskin butuh mata manusia — terutama kontras teks di dark mode. |
| **240 → ~190 raw hex di halaman BELUM migrasi** | `OrderSection` (45), `InfoSection` (24), `Automation` (23), `Pengaturan` (19), `TrackingLinks` (15), `Composer` (14), `Pengguna` (13). Semua `style={{...}}` inline di halaman yang masih 100% CSS legacy. **TIDAK dikonversi** — bukan sekadar ganti nilai, butuh migrasi halamannya (Wave 6). Lewat jembatan token, halaman ini tetap ikut dark mode, tapi hex inline-nya akan tetap warna terang → **kandidat kontras buruk di mode gelap.** |
| **Inbox (`features/inbox/*`)** | Spec Step 4 meminta chat list & chat window ikut ditata. Ditangani lewat override selektor (`.conv-item`, `.conv-unread-badge`) di `tokens.css`, BUKAN penulisan ulang komponen. Cukup untuk border & tema; layout/densitasnya belum disentuh. |
| **`.dash-*` & `.settings-*`** | Masih CSS legacy; border dimatikan lewat override. Belum jadi komponen Tailwind. |
| **Recharts di halaman legacy** | `RingkasanTab` dll sudah pakai `var()`. Chart di halaman belum migrasi masih hex. |
| **Kontras dark mode** | Semantik memakai varian "accessible" Apple untuk light (#D70015/#C93400/#248A3D) dan varian cerah untuk dark. Belum diukur dengan alat kontras. |

---

## 6. Cara pakai (untuk kode baru)

```jsx
// Permukaan
<Card>…</Card>                        // p-6, rounded-card, shadow-card, TANPA border
<CardInset>…</CardInset>              // konten bersarang: tone saja

// Tipe — HANYA lima ini
<h1 className="t-page-title">   <h3 className="t-card-title">
<p className="t-body">          <p className="t-secondary">
<span className="t-caption">    <span className="t-metric">   {/* angka besar */}

// Tombol — maksimal SATU primary per region
<Button>Simpan</Button>                        {/* primary   */}
<Button variant="secondary">Ekspor</Button>
<Button variant="tertiary">Lihat</Button>       {/* aksi baris */}
<Button variant="neutral">Batal</Button>

// Pemisah
<Divider />                            {/* hairline, inset otomatis */}

// Utility warna: bg-surface bg-base bg-inset · text-ink text-ink2 text-ink3
//                bg-accent text-accent bg-accentbg · text-red/orange/green
// JANGAN pakai lagi: bg-white, text-slate-*, border-slate-*, bg-brand-*
```

**Aturan yang ditegakkan di level token:** hue dekoratif lama
(`brand-*`, `chart-violet`, `ai-*`) sekarang **dipetakan ke accent** di
`tokens.css`. Jadi halaman lama tidak bisa lagi memunculkan warna liar meski
kodenya belum diubah.
