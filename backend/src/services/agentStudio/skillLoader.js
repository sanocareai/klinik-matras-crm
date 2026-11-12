// ─── AI STUDIO — PERAKIT SYSTEM PROMPT DARI SKILL (MURNI) ───────────────────
// Skill agent (SKILL.md + references/*.md) disimpan per versi di tabel
// StudioSkillVersion.files sebagai { "path/relatif.md": "isi" }. Fungsi di sini
// merakit isi itu jadi satu system prompt yang STABIL (supaya prompt caching
// Anthropic kena di setiap giliran) + blok katalog live + kontrak output JSON.
//
// Sengaja tidak menyentuh database / jaringan → bisa dites dengan node --test.
import fs from "fs";
import path from "path";

// File referensi yang ikut ke prompt. Urutan = urutan di prompt.
// Ensiklopedia & modul training lengkap TIDAK dimasukkan (terlalu besar,
// jarang dibutuhkan saat chat) — ringkasannya ada di sales-framework/00-index.md.
export const PROMPT_FILES = [
  "SKILL.md",
  "references/60-diagnosa-konsultatif.md",
  "references/20-layanan-dan-rekomendasi.md",
  "references/21-harga.md",
  "references/30-katalog-crm.md",
  "references/40-faq-operasional.md",
  "references/50-persona-dan-playbook-sales-v2.md",
  "references/55-skenario-keberatan.md",
  "references/10-konsep-matras-sehat.md",
  "references/sales-framework/00-index.md",
  "references/sales-framework/SOP-SALES-SANO-v2.md",
];

export const TAHAP = ["SAMBUT", "DIAGNOSA", "EDUKASI", "REKOMENDASI", "HARGA", "KEBERATAN", "CLOSING", "HANDOVER"];

export const OUTPUT_CONTRACT = `
# FORMAT JAWABAN (WAJIB)
Kamu sedang membalas chat WhatsApp customer. Balas HANYA dengan satu objek JSON valid (tanpa teks lain, tanpa \`\`\`), bentuknya:
{
  "bubbles": ["pesan WA 1", "pesan WA 2"],          // 1–3 bubble, masing-masing 1–3 kalimat, maks 1 emoji per bubble
  "kirimKatalog": ["NAMA KARTU PERSIS"],            // 0–3 kartu dari katalog CRM; [] bila tidak perlu
  "tahap": "${TAHAP.join("|")}",
  "dataTerkumpul": { "ukuran": null, "beratBadan": [], "keluhan": null, "kondisiKasur": null, "umurKasur": null, "posisiTidur": null, "riwayatKesehatan": null, "domisili": null },
  "rekomendasi": { "utama": null, "alternatif": null },
  "handover": { "perlu": false, "alasan": null, "prioritas": null },
  "catatanInternal": "1 kalimat untuk sales: kenapa kamu menjawab begini"
}
Isi dataTerkumpul dengan SEMUA data yang sudah diketahui dari seluruh percakapan (bukan hanya pesan terakhir). prioritas handover: "TINGGI" untuk komplain/marah, selain itu "NORMAL".`;

// Baca folder skill bawaan (backend/data/studio-skills/<slug>) → { path: isi }.
// Dipakai untuk menanam versi 1 saat tabel masih kosong.
export function readSkillFolder(dir) {
  const files = {};
  const walk = (sub) => {
    for (const ent of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".md")) files[rel] = fs.readFileSync(path.join(dir, rel), "utf-8");
    }
  };
  walk("");
  return files;
}

// Katalog live dari tabel Product → teks ringkas untuk prompt.
export function formatCatalog(products = []) {
  const rows = products
    .filter((p) => p.active !== false)
    .map((p) => {
      const harga = p.price ? `Rp${Number(p.price).toLocaleString("id-ID")}${p.priceUnit === "mulai dari" ? " (mulai dari)" : ""}` : "—";
      return `- ${p.name} | ${p.category || "-"} | ${harga}`;
    });
  return rows.length ? rows.join("\n") : "(katalog kosong)";
}

// Rakit system prompt. Bagian skill di depan (stabil → cache), katalog &
// kontrak di belakang.
export function buildSystemPrompt(files = {}, products = []) {
  const parts = [];
  for (const p of PROMPT_FILES) {
    if (files[p]) parts.push(`<file path="${p}">\n${files[p].trim()}\n</file>`);
  }
  if (!parts.length) throw new Error("Skill kosong — SKILL.md tidak ditemukan di versi ini");
  return [
    "Kamu adalah agent AI Klinik Matras by SANO Care. Ikuti skill berikut dengan ketat. Jika antar file bertentangan, SKILL.md, SOP-SALES-SANO-v2.md, dan 21-harga.md yang menang.",
    parts.join("\n\n"),
    `# KATALOG CRM SAAT INI (nama kartu persis | kategori | harga). Harga resmi = angka di sini.\n${formatCatalog(products)}`,
    OUTPUT_CONTRACT,
  ].join("\n\n");
}
