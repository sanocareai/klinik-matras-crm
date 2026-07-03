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

// Parse semua entri dari file kategori, terbaru dulu
export function parseEntries(category) {
  const fp = getCategoryFile(category);
  if (!fs.existsSync(fp)) return [];
  const content = fs.readFileSync(fp, "utf-8");
  return content
    .split(/(?=\n## )/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("## "))
    .map((section) => {
      const lines = section.split("\n");
      const title = lines[0].replace(/^## /, "").trim();
      const metaMatch = (lines[1] || "").match(/\*Ditambahkan (.+?) oleh (.+?)\*/);
      const date   = metaMatch?.[1] || "";
      const author = metaMatch?.[2] || "";
      const body   = lines.slice(2).join("\n").replace(/\n?---\s*$/, "").trim();
      return { title, date, author, content: body };
    })
    .reverse();
}
