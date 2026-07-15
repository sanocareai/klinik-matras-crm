// ─── WAVE 4B.0 — BYOK KEY READER (ISOLATED) ─────────────────────────────────
// Membaca kunci Anthropic dari store BYOK yang sudah ada (data/ai-models.json,
// terenkripsi AES-256-CBC dgn kunci turunan JWT_SECRET — skema sama persis dgn
// routes/ai.js). READ-ONLY. Sengaja mandiri agar modul replyAssistant terisolasi
// (tidak meng-import routes/ai.js). Kalau tidak ada key aktif → null (pemanggil
// fallback ke template).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../../../../data/ai-models.json");

function getKey() {
  const secret = process.env.JWT_SECRET || "klinikmatras_secret_default";
  return Buffer.from(secret.padEnd(32, "0").slice(0, 32));
}

function decrypt(encoded) {
  const [ivHex, encHex] = encoded.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getKey(), iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

// Kembalikan { apiKey } untuk model Anthropic aktif pertama yang punya key, atau null.
export function getAnthropicKey() {
  let models;
  try {
    models = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return null;
  }
  const m = models.find((x) => x.active && x.provider === "anthropic" && x.encryptedKey);
  if (!m) return null;
  try {
    return { apiKey: decrypt(m.encryptedKey) };
  } catch {
    return null;
  }
}
