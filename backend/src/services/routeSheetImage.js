// ─── Gambar "sheet" rute — pengganti Google Sheets manual (6 September 2026) ─
//
// Laporan owner: contoh flow kerja SAAT INI adalah Natasha screenshot
// Google Sheets manual (kolom: tanggal, tipe, order, customer, HP, ukuran
// kasur, estimasi jam, urutan, driver, alamat) lalu kirim sebagai GAMBAR ke
// grup driver, DIIKUTI pesan teks ringkas (hari/kendaraan/driver/link Maps/
// catatan per-customer). Owner minta detail lengkap TAPI khawatir teks jadi
// kepanjangan — jawabannya: gambar tabel untuk detail per-stop, teks tetap
// ringkas untuk header+link+catatan (persis pola manual yang sudah ada).
//
// PILIHAN TEKNIS: SVG string + `sharp` (SUDAH jadi dependency, dipakai
// services/kolaseGambar.js untuk kolase foto promo) untuk rasterize ke PNG —
// BUKAN node-canvas/@napi-rs/canvas (dependency baru) ATAU Puppeteer/headless
// Chromium (jauh lebih berat, butuh ratusan MB + system deps tambahan di
// image Docker). `sharp` sudah bisa terima SVG sebagai input & render ke PNG
// langsung (librsvg terbundel di binary prebuilt-nya) — zero dependency baru,
// sesuai filosofi "hemat biaya, mudah dimaintain 1 orang" (CLAUDE.md §2).
//
// Text wrapping SVG dilakukan manual (estimasi lebar karakter, bukan
// pengukuran font sungguhan — SVG <text> tidak auto-wrap). Cukup akurat
// untuk tabel info, TIDAK diklaim presisi typografi.

import sharp from "sharp";
import { parseOrderNotesForInvoice, produkLineLabel } from "./invoice.js";

const KOLOM = [
  { key: "no", label: "No", width: 36, align: "center" },
  { key: "tipe", label: "Tipe", width: 96, align: "center" },
  { key: "customer", label: "Customer", width: 190 },
  { key: "phone", label: "No. HP", width: 130 },
  { key: "produk", label: "Produk & Ukuran", width: 190 },
  { key: "alamat", label: "Alamat", width: 320 },
  { key: "estimasi", label: "Estimasi Jam", width: 150 },
];
const LEBAR = KOLOM.reduce((s, k) => s + k.width, 0);
const TINGGI_HEADER = 40;
const PAD_X = 8;
const PAD_Y_ATAS = 22;
const TINGGI_BARIS_MIN = 34;
const TINGGI_BARIS_ISI = 15; // per baris teks di dalam sel (setelah wrap)
const FONT_SIZE = 12;
const LEBAR_KARAKTER = FONT_SIZE * 0.56; // estimasi kasar, cukup utk tabel info

function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]
  ));
}

// Pecah teks jadi baris yang muat di `width` (px), estimasi kasar per
// karakter — greedy word-wrap standar. Baris kosong ("") tetap 1 baris
// kosong (bukan dihilangkan) supaya tinggi sel konsisten kalau dipanggil
// berulang dengan input campuran ada/tidaknya teks.
function wrapText(text, width) {
  const maxChars = Math.max(4, Math.floor(width / LEBAR_KARAKTER));
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// TIPE (D-055, "Sewa pakai chip TERISI, Pengiriman chip GARIS" — palet
// dibatasi accent/red/orange/green) — di gambar ini SENGAJA warna kuning
// terisi untuk KEDUANYA (Pengambilan/Pengiriman), meniru persis kebiasaan
// visual Sheets manual Natasha (contoh nyata: sel "PENGIRIMAN"/"PENGAMBILAN"
// SAMA-SAMA disorot kuning terang, itu polanya, bukan tebakan) — beda
// konteks dari badge di app (yang punya banyak sinyal warna lain
// berdampingan), gambar ini CUMA satu sinyal: "ini tipe stop apa".
const WARNA_TIPE_BG = "#fef08a";
const WARNA_TIPE_TEKS = "#713f12";

export async function buildRouteSheetImage(route) {
  const jobs = route.jobs || [];
  if (jobs.length === 0) return null;

  const baris = jobs.map((j, idx) => {
    const order = j.order || j.units?.[0]?.unit?.order;
    const customer = order?.customer?.name || "Tanpa nama";
    const phone = order?.customer?.phone || "-";
    const tipe = j.type === "PICKUP" ? "PENGAMBILAN" : "PENGIRIMAN";
    const alamat = j.addressText?.trim() || "(alamat belum diisi)";
    const estimasi = j.timeWindow?.trim() || "-";
    // produk/ukuran — pola SAMA persis dgn stopLines di formatRouteWaMessage
    // (armada.js): produkLineLabel (Lini+Jenis, tanpa duplikasi kata) +
    // ukuranKasur dari parseOrderNotesForInvoice, KHUSUS productLine KASUR.
    let produk = "-";
    if (order) {
      const bagian = [produkLineLabel(order)];
      if (order.productLine === "KASUR") {
        const { ukuranKasur } = parseOrderNotesForInvoice(order.notes);
        if (ukuranKasur) bagian.push(ukuranKasur);
      }
      produk = bagian.join(" · ");
    }

    return { no: String(idx + 1), tipe, customer, phone, produk, alamat, estimasi };
  });

  // Hitung tinggi tiap baris dari kolom PALING BANYAK wrap (biasanya Alamat
  // atau Produk) — semua sel dalam 1 baris tabel harus tinggi yang sama.
  const wrapped = baris.map((b) =>
    KOLOM.reduce((acc, k) => {
      acc[k.key] = wrapText(b[k.key], k.width - PAD_X * 2);
      return acc;
    }, {})
  );
  const tinggiBaris = wrapped.map((w) =>
    Math.max(TINGGI_BARIS_MIN, Math.max(...Object.values(w).map((lines) => lines.length)) * TINGGI_BARIS_ISI + 14)
  );
  const tinggiTotal = TINGGI_HEADER + tinggiBaris.reduce((s, h) => s + h, 0);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${LEBAR}" height="${tinggiTotal}" font-family="Arial, sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${LEBAR}" height="${tinggiTotal}" fill="#ffffff"/>`);

  // Header
  let x = 0;
  parts.push(`<rect x="0" y="0" width="${LEBAR}" height="${TINGGI_HEADER}" fill="#1e2139"/>`);
  for (const k of KOLOM) {
    const tx = k.align === "center" ? x + k.width / 2 : x + PAD_X;
    const anchor = k.align === "center" ? "middle" : "start";
    parts.push(`<text x="${tx}" y="${TINGGI_HEADER / 2 + 4}" font-size="12.5" font-weight="700" fill="#ffffff" text-anchor="${anchor}">${escapeXml(k.label)}</text>`);
    x += k.width;
  }

  // Baris
  let y = TINGGI_HEADER;
  wrapped.forEach((w, i) => {
    const h = tinggiBaris[i];
    const bgBaris = i % 2 === 0 ? "#ffffff" : "#f8fafc";
    parts.push(`<rect x="0" y="${y}" width="${LEBAR}" height="${h}" fill="${bgBaris}"/>`);

    let cx = 0;
    for (const k of KOLOM) {
      if (k.key === "tipe") {
        // Chip kuning terisi (lihat catatan WARNA_TIPE_BG di atas)
        parts.push(`<rect x="${cx + 4}" y="${y + h / 2 - 11}" width="${k.width - 8}" height="22" rx="4" fill="${WARNA_TIPE_BG}"/>`);
        parts.push(`<text x="${cx + k.width / 2}" y="${y + h / 2 + 4}" font-size="10.5" font-weight="700" fill="${WARNA_TIPE_TEKS}" text-anchor="middle">${escapeXml(w.tipe[0])}</text>`);
      } else {
        const lines = w[k.key];
        const anchor = k.align === "center" ? "middle" : "start";
        const tx = k.align === "center" ? cx + k.width / 2 : cx + PAD_X;
        const totalTinggiTeks = lines.length * TINGGI_BARIS_ISI;
        const yMulai = y + h / 2 - totalTinggiTeks / 2 + TINGGI_BARIS_ISI - 4;
        lines.forEach((line, li) => {
          parts.push(`<text x="${tx}" y="${yMulai + li * TINGGI_BARIS_ISI}" font-size="${FONT_SIZE}" fill="#1f2937" text-anchor="${anchor}">${escapeXml(line)}</text>`);
        });
      }
      cx += k.width;
    }
    y += h;
  });

  // Garis vertikal antar kolom (tipis, biar terasa "tabel" bukan cuma teks bersisian)
  let vx = 0;
  for (const k of KOLOM) {
    vx += k.width;
    if (vx < LEBAR) parts.push(`<line x1="${vx}" y1="0" x2="${vx}" y2="${tinggiTotal}" stroke="#e5e7eb" stroke-width="1"/>`);
  }

  parts.push(`</svg>`);
  const svg = parts.join("");

  return sharp(Buffer.from(svg)).png().toBuffer();
}
