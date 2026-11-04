import React, { useId } from "react";
import "@/styles/ik-apple.css";

// KELUARGA IKON APPLE-STYLE untuk Pembelian & Supplier (PO, Pembelian, Tagihan supplier, Jadwal pembayaran, Pembayaran, Daftar supplier).
// Dua wujud dari SATU kumpulan bentuk (viewBox 24):
//   1) UbinApple  — ubin squircle bergradien dengan kilau kaca & glif kaca putih bertinta (KPI, judul bagian, kartu pilihan, tombol utama).
//   2) Glif kecil — duotone berujung bulat (isi 16% + garis), mengikuti currentColor; nama yang sama dengan ikon lucide yang dulu dipakai (Wallet, FileText, Pencil, …),
//                   jadi berkas modul cukup mengganti impor. Berat garis dan sudut bulat seragam (gaya SF Symbols).
// Semua dekoratif (aria-hidden); arti selalu ada di teks di sampingnya.

// ── Bentuk ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// string = path; {c:[cx,cy,r]} lingkaran; {r:[x,y,w,h,rx]} persegi; {e:[cx,cy,rx,ry]} elips. isi = area (diisi lembut); garis = goresan; titik = noktah penuh.
const G = {
  dompet: { nada: "hijau", isi: [{ r: [2.5, 5.5, 19, 14, 3.4] }], garis: ["M16.4 12.1h5.1v3.8h-5.1a1.9 1.9 0 0 1 0-3.8z", "M5.5 5.5l9.6-2.2a1.6 1.6 0 0 1 2 1.5v.7"], titik: [[17.6, 14, 0.7]] },
  koin: { nada: "hijau", isi: [{ e: [12, 7.4, 7.4, 3.1] }, "M4.6 7.4v4.2c0 1.7 3.3 3.1 7.4 3.1s7.4-1.4 7.4-3.1V7.4"], garis: ["M4.6 11.6v4.2c0 1.7 3.3 3.1 7.4 3.1s7.4-1.4 7.4-3.1v-4.2", "M9.2 7.5c1.6.5 4 .5 5.6 0"] },
  dokumen: { nada: "biru", isi: ["M6.8 3h7.2l4.9 4.9v11.6A1.5 1.5 0 0 1 17.4 21H6.8A1.5 1.5 0 0 1 5.3 19.5v-15A1.5 1.5 0 0 1 6.8 3z"], garis: ["M14 3.2v4.2a.7.7 0 0 0 .7.7h4.1", "M8.6 12.6h6.8", "M8.6 16h4.6"] },
  uang: { nada: "hijau", isi: [{ r: [2.5, 6, 19, 12, 2.8] }], garis: [{ c: [12, 12, 2.7] }], titik: [[6, 12, 0.8], [18, 12, 0.8]] },
  gedung: { nada: "grafit", isi: [{ r: [4.5, 3.5, 10.5, 17, 1.9] }, "M15 9.2h3.1a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H15"], garis: ["M7.6 7.4h4.3", "M7.6 11h4.3", "M7.6 14.6h4.3", "M9.8 20.5v-3"] },
  pensil: { nada: "biru", isi: ["M4.2 19.8l.9-4.3L16.5 4.1a2.2 2.2 0 0 1 3.1 3.1L8.2 18.6z"], garis: ["M14.6 6l3.4 3.4"] },
  riwayat: { nada: "indigo", isi: [{ c: [12.6, 12, 7.6] }], garis: ["M12.6 7.9V12l2.8 1.7", "M4.5 12a8.1 8.1 0 1 1 2.4 5.7", "M4.4 17.7v-3.9h3.9"] },
  larang: { nada: "merah", isi: [{ c: [12, 12, 8.6] }], garis: ["M6 6l12 12"] },
  centang: { nada: "hijau", isi: [{ c: [12, 12, 8.6] }], garis: ["M8.1 12.4l2.7 2.7 5.2-5.6"] },
  kalender: { nada: "merah", isi: [{ r: [3.4, 5, 17.2, 15.6, 3.2] }], garis: ["M3.4 10h17.2", "M8 3.2v3.6", "M16 3.2v3.6"], titik: [[8.4, 14, 0.8], [12, 14, 0.8], [15.6, 14, 0.8], [8.4, 17.2, 0.8], [12, 17.2, 0.8]] },
  termin: { nada: "jingga", isi: [{ r: [3.4, 5, 17.2, 15.6, 3.2] }], garis: ["M3.4 10h17.2", "M8 3.2v3.6", "M16 3.2v3.6", { c: [14.8, 16, 2.7] }, "M14.8 14.6v1.5l1 .7"] },
  kiri: { nada: "biru", garis: ["M19.5 12h-14", "M11.5 6l-6 6 6 6"] },
  kanan: { nada: "biru", garis: ["M4.5 12h14", "M12.5 6l6 6-6 6"] },
  tambah: { nada: "biru", garis: ["M12 5v14", "M5 12h14"] },
  keranjang: { nada: "biru", isi: ["M6.2 7.4h13.9l-1.6 7.9a2 2 0 0 1-2 1.6H9.5a2 2 0 0 1-2-1.6L5.5 4.4H3.2"], garis: [{ c: [9.6, 20, 1.2] }, { c: [16.4, 20, 1.2] }] },
  info: { nada: "biru", isi: [{ c: [12, 12, 8.6] }], garis: ["M12 11v5.2"], titik: [[12, 7.9, 1]] },
  peringatan: { nada: "jingga", isi: ["M12 3.5l9 15.7a1.3 1.3 0 0 1-1.1 2H4.1a1.3 1.3 0 0 1-1.1-2z"], garis: ["M12 9.6v4.6"], titik: [[12, 17.4, 1]] },
  galat: { nada: "merah", isi: [{ c: [12, 12, 8.6] }], garis: ["M12 7.6v5.4"], titik: [[12, 16.4, 1]] },
  urung: { nada: "indigo", garis: ["M8.8 14L4 9.2 8.8 4.4", "M4.4 9.2h9.8a5.6 5.6 0 0 1 0 11.2H10.6"] },
  panahKanan: { nada: "biru", garis: ["M9.5 5.5l6.5 6.5-6.5 6.5"] },
  panahBawah: { nada: "biru", garis: ["M5.5 9.5l6.5 6.5 6.5-6.5"] },
  panahKiri: { nada: "biru", garis: ["M14.5 5.5L8 12l6.5 6.5"] },
  panahKiriGanda: { nada: "biru", garis: ["M12.5 6L6.5 12l6 6", "M18.5 6l-6 6 6 6"] },
  panahKananGanda: { nada: "biru", garis: ["M11.5 6l6 6-6 6", "M5.5 6l6 6-6 6"] },
  cari: { nada: "biru", isi: [{ c: [10.8, 10.8, 6.4] }], garis: ["M15.6 15.6l4.6 4.6"] },
  tong: { nada: "merah", isi: ["M6.4 7.6h11.2l-.9 11.4a2 2 0 0 1-2 1.8H9.3a2 2 0 0 1-2-1.8z"], garis: ["M4.6 7.6h14.8", "M9.6 4.2h4.8", "M10.3 11.2v5.6", "M13.7 11.2v5.6"] },
  titikTiga: { nada: "grafit", titik: [[5.6, 12, 1.7], [12, 12, 1.7], [18.4, 12, 1.7]] },
  tanda: { nada: "hijau", garis: ["M5.2 12.8l4.6 4.6L19 7.6"] },
  silang: { nada: "merah", garis: ["M6.2 6.2l11.6 11.6", "M17.8 6.2L6.2 17.8"] },
  gembok: { nada: "grafit", isi: [{ r: [5, 10.5, 14, 10, 2.8] }], garis: ["M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"], titik: [[12, 15.5, 1.1]] },
  segarkan: { nada: "biru", garis: ["M19.8 10.6A8 8 0 0 0 5.7 7.6", "M5 3.8v4.4h4.4", "M4.2 13.4a8 8 0 0 0 14.1 3", "M19 20.2v-4.4h-4.4"] },
  daftarCentang: { nada: "hijau", garis: ["M3.6 6.8l1.8 1.8 3.2-3.4", "M3.6 16.2l1.8 1.8 3.2-3.4", "M12.2 7h8.4", "M12.2 16.6h8.4"] },
  unduh: { nada: "biru", garis: ["M12 4v11", "M7.6 11.2l4.4 4.4 4.4-4.4", "M4.6 19.6h14.8"] },
  mata: { nada: "biru", isi: ["M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z"], garis: [{ c: [12, 12, 2.8] }] },
  // ubin saja
  kotak: { nada: "ungu", isi: ["M12 3.2l8 4.2v9.2l-8 4.2-8-4.2V7.4z"], garis: ["M4 7.4l8 4.2 8-4.2", "M12 11.6v9.2"] },
  bahan: { nada: "grafit", isi: ["M12 3.4l8.4 4.4-8.4 4.4-8.4-4.4z"], garis: ["M3.6 12l8.4 4.4 8.4-4.4", "M3.6 16.2l8.4 4.4 8.4-4.4"] },
  harga: { nada: "hijau", isi: ["M3.6 12.2V4.6a1 1 0 0 1 1-1h7.6l8.2 8.2a1.8 1.8 0 0 1 0 2.5l-6.2 6.2a1.8 1.8 0 0 1-2.5 0z"], titik: [[8, 8, 1.4]] },
  alur: { nada: "indigo", isi: [{ c: [6.2, 6.8, 2.7] }, { c: [17.8, 12, 2.7] }, { c: [6.2, 17.2, 2.7] }], garis: ["M8.6 8.2c4 .6 6.4 1.6 6.8 3", "M8.6 15.8c4-.6 6.4-1.6 6.8-3"] },
  kedatangan: { nada: "jingga", isi: ["M2.8 6.8A1.4 1.4 0 0 1 4.2 5.4h8.6v10.6H2.8z", "M12.8 9h4.2l3.6 3.6V16h-7.8z"], garis: [{ c: [7, 17.2, 1.7] }, { c: [17, 17.2, 1.7] }] },
  persetujuan: { nada: "merahmuda", isi: [{ c: [9.4, 8, 3.3] }, "M3 19.4c0-3.2 2.8-5.4 6.4-5.4s6.4 2.2 6.4 5.4z"], garis: ["M15.8 8.6l1.9 1.9 3.3-3.6"] },
  jam: { nada: "indigo", isi: [{ c: [12, 12, 8.8] }], garis: ["M12 7.2V12l3.2 1.9"] },
  kosong: { nada: "abu", isi: ["M3.6 13.4l2.2-7a1.6 1.6 0 0 1 1.5-1.1h9.4a1.6 1.6 0 0 1 1.5 1.1l2.2 7v4.2a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8z"], garis: ["M3.6 13.4h4.4a.8.8 0 0 1 .8.7 3.4 3.4 0 0 0 6.4 0 .8.8 0 0 1 .8-.7h4.4"] },
};

// Nada ubin: [terang, gelap, bayangan]
const NADA = {
  biru: ["#7FA9FF", "#2F5BFA", "rgba(47,91,250,.5)"],
  hijau: ["#6EE59B", "#0F9F55", "rgba(15,159,85,.5)"],
  ungu: ["#C3A0FF", "#6A3DE0", "rgba(106,61,224,.5)"],
  jingga: ["#FFC45E", "#F47A00", "rgba(244,122,0,.5)"],
  merah: ["#FF8F85", "#E3342B", "rgba(227,52,43,.5)"],
  merahmuda: ["#FFA3CB", "#DE2F7C", "rgba(222,47,124,.5)"],
  indigo: ["#93A0FF", "#4141D8", "rgba(65,65,216,.5)"],
  grafit: ["#52525F", "#17171F", "rgba(23,23,31,.55)"],
  abu: ["#DDE1EE", "#A9B1CB", "rgba(120,130,160,.4)"],
};
const GELAP = { biru: "#1E44D6", hijau: "#087A3F", ungu: "#4E27B8", jingga: "#C25E00", merah: "#B8221A", merahmuda: "#B01F62", indigo: "#2E2EB0", grafit: "#2A2A36", abu: "#5B6485" };

function bentuk(s, k, p) {
  if (typeof s === "string") return <path key={k} d={s} {...p} />;
  if (s.c) return <circle key={k} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} {...p} />;
  if (s.r) return <rect key={k} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={s.r[4] ?? 0} {...p} />;
  if (s.e) return <ellipse key={k} cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} {...p} />;
  return null;
}

// Garis dalam `garis` bisa berupa bentuk atau path; `isi` diisi lembut. Glif kecil mengikuti currentColor.
export function Glif({ nama, size = 16, strokeWidth = 1.8, className, style, ...rest }) {
  const g = G[nama];
  if (!g) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true" focusable="false" {...rest}>
      {(g.isi || []).map((s, i) => bentuk(s, `i${i}`, { fill: "currentColor", fillOpacity: 0.16 }))}
      {(g.garis || []).map((s, i) => bentuk(s, `g${i}`, {}))}
      {(g.titik || []).map(([x, y, r], i) => <circle key={`t${i}`} cx={x} cy={y} r={r} fill="currentColor" stroke="none" />)}
    </svg>
  );
}

// Glif kaca putih (untuk permukaan berwarna, mis. tombol menyala): isi putih tembus + garis putih, bayangan halus.
export function GlifKaca({ nama, size = 18, className }) {
  const g = G[nama];
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!g) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" className={cnx("ik-kaca", className)} aria-hidden="true" focusable="false">
      <defs><linearGradient id={`kg${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".98" /><stop offset="1" stopColor="#fff" stopOpacity=".68" /></linearGradient></defs>
      {(g.isi || []).map((s, i) => bentuk(s, `i${i}`, { fill: `url(#kg${id})`, stroke: "rgba(255,255,255,.75)", strokeWidth: 0.6 }))}
      {(g.garis || []).map((s, i) => bentuk(s, `g${i}`, { stroke: "#fff", strokeWidth: 1.9 }))}
      {(g.titik || []).map(([x, y, r], i) => <circle key={`t${i}`} cx={x} cy={y} r={r} fill="#fff" />)}
    </svg>
  );
}

const cnx = (...a) => a.filter(Boolean).join(" ");

/** Ubin squircle bergradien dengan kilau kaca; glif kaca putih dengan detail bertinta nada ubin. */
export function UbinApple({ nama, ukuran = 40, className, nada }) {
  const g = G[nama];
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!g) return null;
  const kunci = nada || g.nada;
  const t = NADA[kunci] || NADA.biru;
  const tinta = GELAP[kunci] || "#1E44D6";
  const gl = Math.round(ukuran * 0.6);
  return (
    <span className={cnx("ik-ubin", className)} style={{ width: ukuran, height: ukuran, "--u1": t[0], "--u2": t[1], "--ub": t[2] }} aria-hidden="true">
      <svg width={gl} height={gl} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <defs><linearGradient id={`ug${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".99" /><stop offset="1" stopColor="#fff" stopOpacity=".74" /></linearGradient></defs>
        {(g.isi || []).map((s, i) => bentuk(s, `i${i}`, { fill: `url(#ug${id})`, stroke: "rgba(255,255,255,.8)", strokeWidth: 0.6 }))}
        {(g.garis || []).map((s, i) => bentuk(s, `g${i}`, { stroke: g.isi ? tinta : "#fff", strokeOpacity: g.isi ? 0.88 : 1, strokeWidth: g.isi ? 1.7 : 2.1 }))}
        {(g.titik || []).map(([x, y, r], i) => <circle key={`t${i}`} cx={x} cy={y} r={r} fill={tinta} fillOpacity={0.9} />)}
      </svg>
    </span>
  );
}

// ── Ikon bernama lama (keluarga Ik*) → ubin bila besar (≥ 20px), glif kecil bila kecil ────────────────────────────────────────
function Ik({ nama, size = 20, className }) {
  return size >= 20 ? <UbinApple nama={nama} ukuran={Math.round(size * 1.7)} className={className} /> : <Glif nama={nama} size={size} className={className} />;
}
export const IkPesanan = (p) => <Ik nama="dokumen" {...p} />;
export const IkDokumen = (p) => <Ik nama="dokumen" {...p} />;
export const IkKotak = (p) => <Ik nama="kotak" {...p} />;
export const IkBahan = (p) => <Ik nama="bahan" {...p} />;
export const IkAlur = (p) => <Ik nama="alur" {...p} />;
export const IkHarga = (p) => <Ik nama="harga" {...p} />;
export const IkKedatangan = (p) => <Ik nama="kedatangan" {...p} />;
export const IkKalender = (p) => <Ik nama="kalender" {...p} />;
export const IkTermin = (p) => <Ik nama="termin" {...p} />;
export const IkPersetujuan = (p) => <Ik nama="persetujuan" {...p} />;
export const IkKoin = (p) => <Ik nama="koin" {...p} />;
export const IkGedung = (p) => <Ik nama="gedung" {...p} />;
export const IkKosong = (p) => <Ik nama="kosong" {...p} />;
export const IkJam = (p) => <Ik nama="jam" {...p} />;

// ── Pengganti ikon lucide (nama sama; props: size, className, strokeWidth, aria-*) ───────────────────────────────────────────
const peta = (nama, tebal) => (p) => <Glif nama={nama} strokeWidth={tebal} {...p} />;
export const Wallet = peta("dompet");
export const FileText = peta("dokumen");
export const Banknote = peta("uang");
export const Building2 = peta("gedung");
export const Pencil = peta("pensil");
export const History = peta("riwayat");
export const Ban = peta("larang");
export const CheckCircle2 = peta("centang");
export const CalendarClock = peta("termin");
export const ArrowLeft = peta("kiri", 2);
export const ArrowRight = peta("kanan", 2);
export const Plus = peta("tambah", 2.2);
export const ShoppingCart = peta("keranjang");
export const Info = peta("info");
export const AlertTriangle = peta("peringatan");
export const AlertCircle = peta("galat");
export const Undo2 = peta("urung", 2);
export const ChevronRight = peta("panahKanan", 2.2);
export const ChevronDown = peta("panahBawah", 2.2);
export const ChevronLeft = peta("panahKiri", 2.2);
export const ChevronsLeft = peta("panahKiriGanda", 2.2);
export const ChevronsRight = peta("panahKananGanda", 2.2);
export const Search = peta("cari");
export const Trash2 = peta("tong");
export const Check = peta("tanda", 2.4);
export const X = peta("silang", 2.2);
export const Lock = peta("gembok");
export const MoreHorizontal = peta("titikTiga");
export const RefreshCw = peta("segarkan", 2);
export const ListChecks = peta("daftarCentang", 2);
export const Download = peta("unduh", 2);
export const Eye = peta("mata");

/** Ikon item menu aksi (RowActions) → keluarga Apple. Item dibentuk oleh aksiMenu.jsx (bersama, lucide); di modul ini ikonnya dipetakan dari kunci/label, nama lain dibiarkan. */
export function ikonMenuApple(items) {
  const pilih = (it) => {
    const s = `${it.key || ""} ${it.label || ""}`.toLowerCase();
    if (/uang.?muka|terapkan/.test(s)) return Wallet;
    if (/riwayat|versi/.test(s)) return History;
    if (/batal|tolak|nonaktif/.test(s)) return Ban;
    if (/setujui|aktifkan|selesai|centang/.test(s)) return CheckCircle2;
    if (/bayar|pelunasan/.test(s)) return Banknote;
    if (/export|unduh/.test(s)) return Download;
    if (/edit|ubah|koreksi|info/.test(s)) return Pencil;
    return it.icon;
  };
  return (items || []).map((it) => (it && !it.hanyaTeks ? { ...it, icon: pilih(it) } : it));
}
