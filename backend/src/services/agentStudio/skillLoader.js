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
  "references/52-gaya-wa-dan-mode-copilot.md",
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
  "bubbles": ["pesan WA 1", "pesan WA 2"],          // 1–3 bubble, masing-masing 1–3 kalimat, maks 1 emoji per bubble ([] hanya di MODE: COPILOT bila handover.perlu)
  "kirimKatalog": ["NAMA KARTU PERSIS"],            // 0–3 kartu dari katalog CRM; [] bila tidak perlu
  "tahap": "${TAHAP.join("|")}",
  "dataTerkumpul": { "ukuran": null, "beratBadan": [], "keluhan": null, "kondisiKasur": null, "umurKasur": null, "posisiTidur": null, "riwayatKesehatan": null, "domisili": null },
  "rekomendasi": { "utama": null, "alternatif": null },
  "handover": { "perlu": false, "alasan": null, "prioritas": null },
  "catatanInternal": "1 kalimat untuk sales: kenapa kamu menjawab begini"
}
Isi dataTerkumpul dengan SEMUA data yang sudah diketahui dari seluruh percakapan (bukan hanya pesan terakhir). prioritas handover: "TINGGI" untuk komplain/marah, selain itu "NORMAL".`;

// Baca folder skill bawaan (backend/src/services/agentStudio/skill-bawaan/<slug>) → { path: isi }.
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

// Penanda changeNote versi yang berasal dari folder skill bawaan (bukan suntingan manual).
// Versi 1 (MVP 1) memakai "Versi awal dari skill …"; versi hasil sinkron memakai SINKRON_PREFIX.
export const SINKRON_PREFIX = "Sinkron skill bawaan";
export function dariFolderBawaan(changeNote = "") {
  return /^(Versi awal dari skill|Sinkron skill bawaan)/.test(changeNote || "");
}

// true bila isi folder bawaan berbeda dari file versi live (akhir baris diabaikan).
export function skillBerubah(folderFiles = {}, liveFiles = {}) {
  const norm = (s) => String(s ?? "").replace(/\r\n/g, "\n");
  const a = Object.keys(folderFiles).sort();
  const b = Object.keys(liveFiles || {}).sort();
  if (a.length !== b.length || a.some((k, i) => k !== b[i])) return true;
  return a.some((k) => norm(folderFiles[k]) !== norm(liveFiles[k]));
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
// Mode copilot: draft dikirim oleh sales manusia. Blok ini sengaja di DEPAN
// skill dan menang atas aturan handover/"tanya bot" di SKILL.md (uji 13 Nov:
// diletakkan di belakang, model tetap menulis "saya asisten AI").
export const MODE_COPILOT = `# MODE: COPILOT (MENANG ATAS ATURAN LAIN YANG BERTENTANGAN)
Balasanmu adalah DRAFT yang akan diedit lalu dikirim oleh sales MANUSIA dari nomor WA Klinik Matras. Customer membaca pesan itu sebagai pesan dari sales tersebut. Maka:
- JANGAN PERNAH menulis bahwa kamu AI/bot/asisten virtual, dan jangan menulis "saya sambungkan dengan konsultan senior" — sales-nya sudah manusia.
- Situasi "wajib handover" di SKILL.md (komplain, nego/diskon, status order, pembayaran, minta ditelepon) dan customer bertanya "ini bot?" → "bubbles": [], "handover.perlu": true, alasan singkat, dan "catatanInternal" berisi saran apa yang sebaiknya sales lakukan.
- Lanjutkan suara sales di riwayat; jangan memperkenalkan diri atau menyapa ulang.
Detail: references/52-gaya-wa-dan-mode-copilot.md bagian 3.`;

export function buildSystemPrompt(files = {}, products = [], { mode = "playground" } = {}) {
  const parts = [];
  for (const p of PROMPT_FILES) {
    if (files[p]) parts.push(`<file path="${p}">\n${files[p].trim()}\n</file>`);
  }
  if (!parts.length) throw new Error("Skill kosong — SKILL.md tidak ditemukan di versi ini");
  return [
    "Kamu adalah agent AI Klinik Matras by SANO Care. Ikuti skill berikut dengan ketat. Jika antar file bertentangan, SKILL.md, SOP-SALES-SANO-v2.md, dan 21-harga.md yang menang.",
    ...(mode === "copilot" ? [MODE_COPILOT] : []),
    parts.join("\n\n"),
    `# KATALOG CRM SAAT INI (nama kartu persis | kategori | harga). Harga resmi = angka di sini.\n${formatCatalog(products)}`,
    OUTPUT_CONTRACT,
  ].join("\n\n");
}
