// Tes AI Studio — bagian MURNI (perakit prompt, cek keras, runtime dengan
// pemanggil model tiruan). Tidak menyentuh database / jaringan.
import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";

import { buildSystemPrompt, readSkillFolder, formatCatalog, PROMPT_FILES, skillBerubah, dariFolderBawaan } from "../src/services/agentStudio/skillLoader.js";
import { runChecks, extractPrices, countPriceAsks } from "../src/services/agentStudio/checks.js";
import { runTurn, parseAgentJson, estimateCost, toModelMessages } from "../src/services/agentStudio/runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.join(__dirname, "../src/services/agentStudio/skill-bawaan/sano-mattress-consultant");
const PRODUCTS = [
  { name: "Paket Upgrade 160 Fondasi+lapisan Matras sehat", category: "Upgrade", price: 3290000, priceUnit: "per unit", active: true },
  { name: "Service 160 Fondasi+Tambah busa", category: "Servis", price: 1600000, priceUnit: "per unit", active: true },
  { name: "Add Lapisan Soft Foam", category: "Upgrade", price: 500000, priceUnit: "mulai dari", active: true, description: "90/100: 500.000 · 160: 800.000" },
  { name: "FULL UPGRADE 160", category: "Upgrade", price: 3790000, active: false },
];

test("skill bawaan terbaca & prompt memuat SKILL.md, katalog aktif, dan kontrak JSON", () => {
  const files = readSkillFolder(SKILL_DIR);
  assert.ok(files["SKILL.md"], "SKILL.md harus ada");
  assert.ok(files["references/21-harga.md"]);
  const prompt = buildSystemPrompt(files, PRODUCTS);
  assert.match(prompt, /Mattress Consultant/);
  assert.match(prompt, /Paket Upgrade 160 Fondasi\+lapisan Matras sehat \| Upgrade \| Rp3\.290\.000/);
  assert.doesNotMatch(prompt, /FULL UPGRADE 160/, "produk nonaktif tidak boleh masuk prompt");
  assert.match(prompt, /FORMAT JAWABAN \(WAJIB\)/);
});

test("prompt menolak skill tanpa SKILL.md", () => {
  assert.throws(() => buildSystemPrompt({}, PRODUCTS), /SKILL\.md/);
});

test("formatCatalog menandai harga 'mulai dari'", () => {
  assert.match(formatCatalog(PRODUCTS), /Rp500\.000 \(mulai dari\)/);
});

test("cek keras: harga di luar katalog & harga terlalu cepat terdeteksi", () => {
  const out = { bubbles: ["Untuk 160 harganya Rp3.100.000 Kak"], dataTerkumpul: {}, handover: { perlu: false } };
  const hasil = runChecks(out, { products: PRODUCTS, customerText: "harganya berapa?", priceAsks: 1 });
  const by = Object.fromEntries(hasil.map((h) => [h.kode, h]));
  assert.equal(by.HARGA_SESUAI_KATALOG.lulus, false);
  assert.equal(by.HARGA_SETELAH_DIAGNOSA.lulus, false);
});

test("cek keras: harga boleh setelah customer bertanya 2x, termasuk harga per ukuran di deskripsi", () => {
  const out = { bubbles: ["Untuk 160 upgrade Rp3.290.000, soft foam Rp800.000"], dataTerkumpul: {}, handover: { perlu: false } };
  const hasil = runChecks(out, { products: PRODUCTS, customerText: "brp sih", priceAsks: 2 });
  assert.ok(hasil.every((h) => h.lulus), JSON.stringify(hasil.filter((h) => !h.lulus)));
});

test("cek keras: diskon, klaim medis, layanan lama, emoji berlebih, handover komplain", () => {
  const out = { bubbles: ["Ada diskon 20% Kak 😊😊", "Dijamin sembuh dengan full upgrade"], dataTerkumpul: { ukuran: "160" }, handover: { perlu: false } };
  const hasil = runChecks(out, { products: PRODUCTS, customerText: "saya kecewa banget kasurnya", priceAsks: 0 });
  const gagal = hasil.filter((h) => !h.lulus).map((h) => h.kode).sort();
  assert.deepEqual(gagal, ["HANDOVER_TEPAT", "LAYANAN_MASIH_DIJUAL", "MAKS_1_EMOJI", "TANPA_DISKON", "TANPA_KLAIM_MEDIS"]);
});

test("menolak diskon dengan sopan tidak dianggap pelanggaran", () => {
  const out = { bubbles: ["Untuk promo saya cek ke tim dulu ya Kak 🙏"], dataTerkumpul: {}, handover: { perlu: true } };
  const hasil = runChecks(out, { products: PRODUCTS, customerText: "ada diskon?", priceAsks: 0 });
  assert.ok(hasil.find((h) => h.kode === "TANPA_DISKON").lulus);
  assert.ok(hasil.find((h) => h.kode === "HANDOVER_TEPAT").lulus);
});

test("utilitas kecil: extractPrices, countPriceAsks, parseAgentJson, estimateCost", () => {
  assert.deepEqual(extractPrices("Rp1.600.000 dan Rp 800.000"), [1600000, 800000]);
  assert.equal(countPriceAsks(["halo", "harganya berapa", "PL nya kak"]), 2);
  assert.deepEqual(parseAgentJson('```json\n{"bubbles":["a"]}\n```'), { bubbles: ["a"] });
  assert.equal(parseAgentJson("bukan json"), null);
  assert.ok(Math.abs(estimateCost("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 0 }) - 0.10) < 1e-9);
  assert.equal(estimateCost("model-tak-dikenal", { inputTokens: 1000 }), 0);
});

test("toModelMessages menyusun riwayat customer/agent", () => {
  const msgs = toModelMessages([
    { role: "CUSTOMER", content: { text: "halo" } },
    { role: "AGENT", content: { bubbles: ["Halo Kak"], tahap: "SAMBUT" } },
  ]);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[1].role, "assistant");
  assert.match(msgs[1].content, /"tahap":"SAMBUT"/);
});

test("runTurn: output terurai, cek keras berjalan, biaya dihitung", async () => {
  const files = readSkillFolder(SKILL_DIR);
  let dipanggil = null;
  const callModel = async (args) => {
    dipanggil = args;
    return {
      reply: JSON.stringify({ bubbles: ["Halo Kak 😊", "Boleh cerita keluhannya?"], kirimKatalog: [], tahap: "SAMBUT", dataTerkumpul: {}, handover: { perlu: false } }),
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 20000 },
    };
  };
  const r = await runTurn({ skillFiles: files, products: PRODUCTS, history: [], customerText: "Kasur 160 harganya berapa?", callModel });
  assert.equal(dipanggil.messages.at(-1).content, "Kasur 160 harganya berapa?");
  assert.equal(r.output.tahap, "SAMBUT");
  assert.equal(r.output.bubbles.length, 2);
  assert.ok(r.output.checks.every((c) => c.lulus));
  assert.ok(r.costUsd > 0);
});

test("runTurn: jawaban bukan JSON tetap ditampilkan dan ditandai gagal format", async () => {
  const files = readSkillFolder(SKILL_DIR);
  const r = await runTurn({ skillFiles: files, products: PRODUCTS, customerText: "halo", callModel: async () => ({ reply: "Halo Kak, ada yang bisa dibantu?", usage: {} }) });
  assert.equal(r.output.bubbles[0], "Halo Kak, ada yang bisa dibantu?");
  assert.equal(r.output.checks[0].kode, "FORMAT_JSON");
  assert.equal(r.output.checks[0].lulus, false);
});

test("MVP 2: gaya WA & mode copilot ikut ke prompt; semua PROMPT_FILES ada di folder bawaan", () => {
  const files = readSkillFolder(SKILL_DIR);
  for (const f of PROMPT_FILES) assert.ok(files[f], `${f} ada di skill bawaan`);
  const prompt = buildSystemPrompt(files, PRODUCTS);
  assert.match(prompt, /MODE: COPILOT/);
  assert.match(prompt, /Ikuti register customer/);
});

test("MVP 2: sinkron skill bawaan — deteksi perubahan & asal versi", () => {
  assert.equal(skillBerubah({ "SKILL.md": "a\nb" }, { "SKILL.md": "a\r\nb" }), false, "akhir baris diabaikan");
  assert.equal(skillBerubah({ "SKILL.md": "a", "references/x.md": "b" }, { "SKILL.md": "a" }), true, "file baru");
  assert.equal(skillBerubah({ "SKILL.md": "a" }, { "SKILL.md": "a", "references/x.md": "b" }), true, "file dihapus");
  assert.equal(skillBerubah({ "SKILL.md": "a" }, { "SKILL.md": "b" }), true, "isi berubah");
  assert.equal(dariFolderBawaan("Versi awal dari skill sano-mattress-consultant (Nov 2026)"), true);
  assert.equal(dariFolderBawaan("Sinkron skill bawaan (2026-11-13)"), true);
  assert.equal(dariFolderBawaan("Suntingan Owner: harga baru"), false);
  assert.equal(dariFolderBawaan(null), false);
});

test("MVP 2: bubble kosong sah hanya bila handover", async () => {
  const kosong = (handover) => async () => ({ reply: JSON.stringify({ bubbles: [], tahap: "HANDOVER", handover }), usage: {} });
  const a = await runTurn({ skillFiles: { "SKILL.md": "x" }, customerText: "ini bot ya?", callModel: kosong({ perlu: true, alasan: "tanya bot" }) });
  assert.deepEqual(a.output.bubbles, []);
  assert.ok(!a.output.checks.some((c) => c.kode === "FORMAT_JSON"));
  const b = await runTurn({ skillFiles: { "SKILL.md": "x" }, customerText: "halo", callModel: kosong({ perlu: false }) });
  assert.ok(b.output.checks.some((c) => c.kode === "FORMAT_JSON" && !c.lulus));
});

test("MVP 2: cek GAYA_NATURAL & COPILOT_SUARA_SALES", () => {
  const cek = (bubbles, mode) => Object.fromEntries(runChecks({ bubbles }, { products: PRODUCTS, mode }).map((c) => [c.kode, c.lulus]));
  assert.equal(cek(["Terima kasih infonya Kak. Kasurnya sudah berapa lama?"]).GAYA_NATURAL, false);
  assert.equal(cek(["Terima kasih telah menghubungi Klinik Matras"]).GAYA_NATURAL, false);
  assert.equal(cek(["Oke Kak.\n\nBoleh tau ukurannya?"]).GAYA_NATURAL, false, "baris kosong dalam bubble");
  assert.equal(cek(["Cekung di tengah memang sering bikin pinggang pegal Kak.", "Ukurannya berapa?"]).GAYA_NATURAL, true);
  assert.equal(cek(["Betul Kak, saya asisten AI dari tim Klinik Matras"], "copilot").COPILOT_SUARA_SALES, false);
  assert.equal(cek(["Saya sambungkan dengan konsultan senior kami ya"], "copilot").COPILOT_SUARA_SALES, false);
  assert.equal(cek(["Ukurannya berapa Kak?"], "copilot").COPILOT_SUARA_SALES, true);
  assert.equal(cek(["Saya sambungkan dengan konsultan senior kami ya"]).COPILOT_SUARA_SALES, undefined, "hanya di mode copilot");
});
