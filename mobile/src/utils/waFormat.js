// Port React Native dari frontend/src/utils/waFormat.jsx — logika parser
// HARUS identik (pola regex sama persis) supaya teks yang sama tampil sama
// di web CRM dan mobile. Bedanya cuma output: web pakai <strong>/<em>/<a>
// (elemen DOM), RN tidak punya elemen itu — jadi di sini output-nya array
// nested <Text> dengan style (fontWeight/fontStyle/textDecorationLine),
// karena RN cuma bisa styling teks lewat <Text>, bukan tag semantik.
import React from "react";
import { Text, Linking } from "react-native";

// WhatsApp cuma punya 4 gaya format (TIDAK ADA underline — bukan fitur asli
// WhatsApp): *tebal* _miring_ ~coret~ ```monospace```
const POLA = [
  { re: /```([^`]+)```/, jenis: "code", rekursif: false },
  { re: /(https?:\/\/[^\s<]+)/, jenis: "link", rekursif: false },
  { re: /\*([^*\n]+)\*/, jenis: "bold", rekursif: true },
  { re: /_([^_\n]+)_/, jenis: "italic", rekursif: true },
  { re: /~([^~\n]+)~/, jenis: "strike", rekursif: true },
];

function cariTerdekat(text) {
  let terbaik = null;
  for (const pola of POLA) {
    const m = pola.re.exec(text);
    if (m && (terbaik === null || m.index < terbaik.m.index)) terbaik = { m, pola };
  }
  return terbaik;
}

const STYLE_BY_JENIS = {
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  code: { fontFamily: "monospace", fontSize: 13 },
};

// Kembalikan array node (string + <Text>) — dipakai sebagai children dari
// <Text> pembungkus, mis. `<Text style={styles.text}>{parseWaFormatting(text)}</Text>`.
// Rekursi dibatasi (depth<3) supaya kombinasi seperti *_tebal miring_* tetap
// jalan tanpa risiko loop.
export function parseWaFormatting(text, depth = 0, linkColor) {
  if (!text) return null;
  const nodes = [];
  let sisa = String(text);
  let key = 0;

  while (sisa.length > 0) {
    const found = cariTerdekat(sisa);
    if (!found) { nodes.push(sisa); break; }
    const { m, pola } = found;
    if (m.index > 0) nodes.push(sisa.slice(0, m.index));
    const isi = m[1];
    if (pola.jenis === "link") {
      nodes.push(
        <Text
          key={key++}
          style={linkColor ? { color: linkColor, textDecorationLine: "underline" } : { textDecorationLine: "underline" }}
          onPress={() => Linking.openURL(isi).catch(() => {})}
        >
          {isi}
        </Text>
      );
    } else {
      nodes.push(
        <Text key={key++} style={STYLE_BY_JENIS[pola.jenis]}>
          {pola.rekursif && depth < 2 ? parseWaFormatting(isi, depth + 1, linkColor) : isi}
        </Text>
      );
    }
    sisa = sisa.slice(m.index + m[0].length);
  }
  return nodes;
}

// ── Toolbar formatting composer (mirip menu Bold/Italic/Strikethrough/
// Monospace yang muncul di WhatsApp asli saat teks di-seleksi) ────────────
// Port dari toggleWaFormat di frontend/src/utils/waFormat.jsx — di sana
// argumennya `el` (elemen <textarea> DOM, ambil selectionStart/End sendiri),
// di RN TextInput tidak expose itu, jadi versi ini terima {start, end}
// langsung dari state `onSelectionChange`. Logika toggle SAMA PERSIS: kalau
// seleksi sudah persis dibungkus marker ini, lepas (bukan dobel-bungkus).
export const WA_MARKERS = { bold: "*", italic: "_", strike: "~", mono: "```" };

export function toggleWaFormatRN(draft, start, end, marker) {
  const selected = draft.slice(start, end);
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
