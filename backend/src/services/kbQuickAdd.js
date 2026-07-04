import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "../../data/knowledge");

export const VALID_CATEGORIES = [
  "konsep-istilah-teknis",
  "dunia-kasur-umum",
  "faq-tambahan",
  "insight-lapangan",
];

export const CATEGORY_LABELS = {
  "konsep-istilah-teknis": "Konsep & Istilah Teknis",
  "dunia-kasur-umum":      "Dunia Kasur Umum",
  "faq-tambahan":          "FAQ Tambahan",
  "insight-lapangan":      "Insight Lapangan",
};

function getCategoryFile(category) {
  return path.join(KB_DIR, `${category}.md`);
}

function ensureFile(category) {
  const fp = getCategoryFile(category);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(
      fp,
      `# ${CATEGORY_LABELS[category]}\n\nKoleksi entri yang ditambahkan via Sano Co-pilot oleh admin.\n\n`
    );
  }
  return fp;
}

// Tambah entri baru ke file kategori
export function appendToKbCategory({ category, title, content, authorName }) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Kategori tidak valid: ${category}`);
  }
  const fp = ensureFile(category);
  const dateStr = new Date().toLocaleDateString("id-ID", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const entry = `\n## ${title}\n*Ditambahkan ${dateStr} oleh ${authorName}*\n\n${content}\n\n---\n`;
  fs.appendFileSync(fp, entry);
  return { category, label: CATEGORY_LABELS[category], title, author: authorName, date: dateStr };
}

// Hitung jumlah entri di sebuah kategori
export function countEntries(category) {
  const fp = getCategoryFile(category);
  if (!fs.existsSync(fp)) return 0;
  return (fs.readFileSync(fp, "utf-8").match(/^## /gm) || []).length;
}

// Pisahkan file menjadi [preamble, ...entryChunks]
// chunks[0] = header/preamble (dimulai dengan #)
// chunks[1..] = tiap blok entri (dimulai dengan \n## )
function splitFileChunks(raw) {
  return raw.split(/(?=\n## )/);
}

// Parse semua entri dari file kategori, terbaru dulu
// Setiap entri menyertakan `index` (posisi di file, 0-based) untuk keperluan edit/hapus
export function parseEntries(category) {
  const fp = getCategoryFile(category);
  if (!fs.existsSync(fp)) return [];
  const content = fs.readFileSync(fp, "utf-8");
  const entries = content
    .split(/(?=\n## )/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("## "))
    .map((section, i) => {
      const lines = section.split("\n");
      const title = lines[0].replace(/^## /, "").trim();
      const metaMatch = (lines[1] || "").match(/\*Ditambahkan (.+?) oleh (.+?)\*/);
      const date   = metaMatch?.[1] || "";
      const author = metaMatch?.[2] || "";
      const body   = lines.slice(2).join("\n").replace(/\n?---\s*$/, "").trim();
      return { title, date, author, content: body, index: i };
    });
  return entries.reverse();
}

// Update entri di posisi `index` (0-based, posisi di file)
// Metadata (date, author) dipertahankan — hanya title dan content yang diubah
export function updateEntry(category, index, { title, content }) {
  if (!VALID_CATEGORIES.includes(category)) throw new Error("Kategori tidak valid");
  const fp = getCategoryFile(category);
  const raw = fs.readFileSync(fp, "utf-8");
  const chunks = splitFileChunks(raw);
  // chunks[0] = preamble, chunks[1..] = entri
  const entryIdx = index + 1;
  if (entryIdx < 1 || entryIdx >= chunks.length) throw new Error("Index entri tidak valid");
  const old = chunks[entryIdx];
  const metaLine = old.split("\n").find((l) => l.startsWith("*Ditambahkan")) || "";
  chunks[entryIdx] = `\n## ${title}\n${metaLine}\n\n${content}\n\n---\n`;
  fs.writeFileSync(fp, chunks.join(""));
}

// Hapus entri di posisi `index` (0-based, posisi di file)
export function deleteEntry(category, index) {
  if (!VALID_CATEGORIES.includes(category)) throw new Error("Kategori tidak valid");
  const fp = getCategoryFile(category);
  const raw = fs.readFileSync(fp, "utf-8");
  const chunks = splitFileChunks(raw);
  const entryIdx = index + 1;
  if (entryIdx < 1 || entryIdx >= chunks.length) throw new Error("Index entri tidak valid");
  chunks.splice(entryIdx, 1);
  fs.writeFileSync(fp, chunks.join(""));
}
