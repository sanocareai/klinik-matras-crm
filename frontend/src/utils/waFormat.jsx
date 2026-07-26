import React from "react";

// ═══ FORMAT TEKS GAYA WHATSAPP ════════════════════════════════════════════
// BUG YANG DIPERBAIKI: bubble pesan (MessageBubble.jsx) merender `content`
// sebagai teks POLOS di dalam <span> — kalau sales/customer mengetik
// "*penting*" (sintaks bold asli WhatsApp), yang tampil di CRM cuma
// tanda bintang literal, bukan tebal. Padahal WAHA/WhatsApp SENDIRI yang
// merender jadi tebal di HP customer — CRM-nya yang belum tahu cara baca
// sintaksnya sendiri.
//
// WhatsApp CUMA punya 4 gaya format (TIDAK ADA underline — itu bukan fitur
// WhatsApp asli, jangan ditambahkan supaya teks yang dikirim benar-benar
// tampil sama persis di WhatsApp customer, bukan simbol yang tidak dikenali):
//   *tebal*   _miring_   ~coret~   ```monospace```
//
// Parser ini SENGAJA regex sederhana (bukan library markdown), karena aturan
// WhatsApp sendiri sederhana dan kita HARUS meniru perilaku WhatsApp persis
// — bukan markdown umum (mis. WhatsApp tidak mendukung **tebal** gaya
// Markdown, cuma satu bintang).
const POLA = [
  // Monospace duluan & TIDAK rekursif — isi di dalam ``` tidak boleh ikut
  // diproses format lain (sama seperti code block markdown biasa).
  { re: /```([^`]+)```/, Tag: "code", rekursif: false, style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", background: "var(--bg-inset, rgba(0,0,0,0.06))", padding: "1px 4px", borderRadius: 4, fontSize: "0.92em" } },
  // BUG YANG DIPERBAIKI: teks pesan polos (mis. link lokasi Google Maps yang
  // customer tempel manual, BUKAN lewat fitur "Bagikan Lokasi" native
  // WhatsApp) sebelumnya dirender sebagai <span> teks biasa — sama sekali
  // tidak bisa diklik, beda dari WhatsApp asli yang auto-linkify URL apa pun
  // di teks. Pola ini menangkap URL http(s) dan membungkusnya jadi <a>
  // sungguhan. rekursif:false karena isi URL tidak boleh diproses ulang
  // (URL bisa saja kebetulan mengandung karakter _ atau ~).
  { re: /(https?:\/\/[^\s<]+)/, isLink: true, rekursif: false },
  { re: /\*([^*\n]+)\*/, Tag: "strong", rekursif: true },
  { re: /_([^_\n]+)_/,   Tag: "em",     rekursif: true },
  { re: /~([^~\n]+)~/,   Tag: "del",    rekursif: true },
];

function cariTerdekat(text) {
  let terbaik = null;
  for (const pola of POLA) {
    const m = pola.re.exec(text);
    if (m && (terbaik === null || m.index < terbaik.m.index)) terbaik = { m, pola };
  }
  return terbaik;
}

// Kembalikan array node React (string + elemen) — dipakai langsung di dalam
// JSX seperti `{parseWaFormatting(text)}`. Rekursi dibatasi (depth<3) supaya
// kombinasi wajar seperti *_tebal miring_* tetap bekerja tanpa risiko loop.
export function parseWaFormatting(text, depth = 0) {
  if (!text) return null;
  const nodes = [];
  let sisa = String(text);
  let key = 0;

  while (sisa.length > 0) {
    const found = cariTerdekat(sisa);
    if (!found) { nodes.push(sisa); break; }
    const { m, pola } = found;
    if (m.index > 0) nodes.push(sisa.slice(0, m.index));
    const { Tag, rekursif, style, isLink } = pola;
    const isi = m[1];
    nodes.push(
      isLink ? (
        <a key={key++} href={isi} target="_blank" rel="noreferrer" className="bubble-link" onClick={(e) => e.stopPropagation()}>
          {isi}
        </a>
      ) : (
      <Tag key={key++} style={style}>
        {rekursif && depth < 2 ? parseWaFormatting(isi, depth + 1) : isi}
      </Tag>
      )
    );
    sisa = sisa.slice(m.index + m[0].length);
  }
  return nodes;
}

// ── Deteksi link lokasi tempel-manual (dipakai MessageBubble.jsx) ─────────
// BUG YANG DIPERBAIKI: kalau customer mengirim lokasi lewat fitur "Bagikan
// Lokasi" NATIVE WhatsApp, WAHA mengirim mediaType:"location" terpisah
// (sudah ditangani LocationCard di MessageBubble). Tapi kalau customer
// cuma COPY-PASTE link Google/Apple Maps sebagai teks biasa (jauh lebih
// umum di lapangan — banyak orang share lokasi toko/rumah lewat link, bukan
// fitur share-lokasi), pesan itu masuk sebagai teks POLOS, tidak pernah
// jadi kartu lokasi — sebelumnya cuma tampil sebagai teks (bahkan tidak
// bisa diklik sebelum fix auto-link di atas). Deteksi ini mengenali pola
// link populer supaya kartu lokasi WA-style tetap muncul walau lewat teks.
const MAPS_PATTERNS = [
  /google\.[a-z.]+\/maps\/?\?q=(-?\d+\.\d+),(-?\d+\.\d+)/i,
  /google\.[a-z.]+\/maps\/@(-?\d+\.\d+),(-?\d+\.\d+)/i,
  /google\.[a-z.]+\/maps\/place\/[^/]*\/@(-?\d+\.\d+),(-?\d+\.\d+)/i,
  /maps\.apple\.com\/\?ll=(-?\d+\.\d+),(-?\d+\.\d+)/i,
  /^geo:(-?\d+\.\d+),(-?\d+\.\d+)/i,
];

export function extractMapsLocation(text) {
  if (!text) return null;
  const trimmed = text.trim();
  // Hanya dianggap "link lokasi" kalau SELURUH isi pesan cuma URL itu sendiri
  // (tanpa spasi/kalimat lain) — supaya pesan panjang yang kebetulan
  // menyisipkan link maps di tengah kalimat tidak keliru dianggap seluruhnya
  // sebuah share lokasi.
  if (!/^(https?:\/\/|geo:)/i.test(trimmed) || /\s/.test(trimmed)) return null;
  for (const re of MAPS_PATTERNS) {
    const m = re.exec(trimmed);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}

// ── Toolbar formatting (dipakai Composer.jsx) ──────────────────────────────
// Sisip/lepas simbol format di sekitar teks yang DIPILIH di textarea — pola
// yang SAMA seperti tombol Bold/Italic di WhatsApp Web asli: kalau ada teks
// terpilih, dibungkus simbol; kalau tidak, simbol kosong disisipkan dan
// kursor diposisikan di tengah supaya user tinggal mengetik.
export const WA_MARKERS = { bold: "*", italic: "_", strike: "~" };

export function toggleWaFormat(el, draft, marker) {
  const start = el.selectionStart ?? draft.length;
  const end   = el.selectionEnd ?? draft.length;
  const selected = draft.slice(start, end);

  // Sudah dibungkus persis oleh marker ini? Lepas (toggle off) — supaya
  // klik dua kali pada seleksi yang sama membatalkan formatnya, bukan
  // menumpuk jadi **teks** dobel.
  const sudahDibungkus = selected.length >= marker.length * 2 &&
    selected.startsWith(marker) && selected.endsWith(marker);

  let nextText, selStart, selEnd;
  if (sudahDibungkus) {
    const inti = selected.slice(marker.length, selected.length - marker.length);
    nextText = draft.slice(0, start) + inti + draft.slice(end);
    selStart = start; selEnd = start + inti.length;
  } else {
    const dibungkus = marker + selected + marker;
    nextText = draft.slice(0, start) + dibungkus + draft.slice(end);
    selStart = start + marker.length;
    selEnd = selStart + selected.length;
  }
  return { nextText, selStart, selEnd };
}
