// Penjaga: pastikan setiap kolom yang dipakai broadcast.js untuk orderBy
// BENAR-BENAR ada di schema.prisma.
//
// KENAPA TES INI ADA. 14 Agt 2026 broadcast gagal total di production:
// kirimSatuTarget memakai `orderBy: { updatedAt: "desc" }` pada model
// Conversation, padahal model itu tidak punya kolom updatedAt (yang ada
// lastMessageAt). Prisma menolak query, tick() melempar
// PrismaClientValidationError yang .message-nya KOSONG, dan log cuma
// mencetak "[broadcast] tick error: " tanpa keterangan. Kampanye berstatus
// BERJALAN dengan 300 target, tapi NOL pesan terkirim — dan tidak ada
// sinyal jelas kenapa. Baru ketahuan saat dicoba kirim sungguhan.
//
// Tes unit yang ada waktu itu tidak menangkapnya karena semuanya menguji
// logika murni (kuota, jam kirim, filter) yang tidak menyentuh Prisma.
// Tes ini menutup celah itu TANPA perlu database yang menyala: cukup baca
// schema.prisma sebagai sumber kebenaran, lalu cocokkan dengan kode.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(__dirname, "../prisma/schema.prisma");
const SUMBER = [
  path.join(__dirname, "../src/routes/broadcast.js"),
];

/**
 * Petakan nama model Prisma -> { fields: Set, relasi: { namaField -> modelTujuan } }.
 *
 * Tipe field ikut dibaca supaya penelusuran bisa MASUK ke relasi bersarang
 * (mis. customer.findMany({ select: { conversations: { orderBy: ... } } })).
 * Tanpa itu, orderBy milik relasi salah dicocokkan ke model induknya dan
 * penjaga ini melapor kesalahan palsu.
 */
function bacaModel() {
  const teks = fs.readFileSync(SCHEMA, "utf8");
  const semuaModel = new Set();
  const mentah = {};

  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(teks))) {
    semuaModel.add(m[1]);
    mentah[m[1]] = m[2];
  }

  const model = {};
  for (const [nama, isi] of Object.entries(mentah)) {
    const fields = new Set();
    const relasi = {};
    for (const baris of isi.split("\n")) {
      const bersih = baris.trim();
      if (!bersih || bersih.startsWith("//") || bersih.startsWith("@@")) continue;
      const f = bersih.match(/^(\w+)\s+(\w+)/);
      if (!f) continue;
      fields.add(f[1]);
      // Tipe yang namanya sama dengan sebuah model = relasi.
      if (semuaModel.has(f[2])) relasi[f[1]] = f[2];
    }
    model[nama] = { fields, relasi };
  }
  return model;
}

/** prisma.broadcastTarget -> BroadcastTarget */
function keNamaModel(prop) {
  return prop.charAt(0).toUpperCase() + prop.slice(1);
}

/**
 * Kumpulkan orderBy TINGKAT TERATAS dari tiap pemanggilan prisma.
 *
 * SENGAJA hanya tingkat teratas. orderBy yang bersarang di dalam relasi
 * (mis. customer -> conversations -> orderBy) harus dicocokkan ke model
 * relasinya, dan melacak itu lewat teks memerlukan penelusuran kurung yang
 * mudah salah — versi awal penjaga ini justru melaporkan kesalahan palsu
 * karena keliru menganggap orderBy relasi milik model induk.
 *
 * Batasan ini tidak melemahkan tujuannya: bug yang mau dicegah (14 Agt
 * 2026) TEPAT berbentuk orderBy tingkat teratas pada findFirst. Lebih baik
 * penjaga sempit yang selalu benar daripada penjaga luas yang sering
 * berteriak palsu lalu diabaikan orang.
 */
function kumpulkanOrderBy(file, model) {
  const teks = fs.readFileSync(file, "utf8");
  const baris = teks.split("\n");
  const temuan = [];

  for (let i = 0; i < baris.length; i++) {
    const panggil = baris[i].match(/prisma\.(\w+)\.(findFirst|findMany|count|groupBy|updateMany|deleteMany)/);
    if (!panggil) continue;

    const namaModel = keNamaModel(panggil[1]);
    let dalam = 0;
    let mulai = false;

    for (let j = i; j < Math.min(i + 40, baris.length); j++) {
      const b = baris[j];

      // Kedalaman SEBELUM baris ini diproses menentukan apakah orderBy di
      // sini tingkat teratas. Argumen query ada di kedalaman 1.
      const dalamAwal = dalam;

      if (dalamAwal === 1) {
        const satu = b.match(/^\s*orderBy:\s*\{\s*(\w+):/);
        if (satu) temuan.push({ file, model: namaModel, field: satu[1], baris: j + 1 });
        if (/^\s*orderBy:\s*\[/.test(b)) {
          for (const f of b.matchAll(/\{\s*(\w+):/g)) {
            temuan.push({ file, model: namaModel, field: f[1], baris: j + 1 });
          }
        }
      }

      for (const ch of b) {
        if (ch === "{") { dalam++; mulai = true; }
        else if (ch === "}") dalam--;
      }
      if (mulai && dalam <= 0) break; // panggilan selesai
    }
  }
  return temuan;
}

test("setiap orderBy di broadcast.js menunjuk kolom yang benar-benar ada di schema", () => {
  const model = bacaModel();
  const masalah = [];

  for (const file of SUMBER) {
    for (const t of kumpulkanOrderBy(file, model)) {
      const def = model[t.model];
      if (!def) {
        masalah.push(`${path.basename(t.file)}:${t.baris} — model "${t.model}" tidak ada di schema.prisma`);
        continue;
      }
      if (!def.fields.has(t.field)) {
        masalah.push(
          `${path.basename(t.file)}:${t.baris} — ${t.model} TIDAK punya kolom "${t.field}". ` +
          `Kolom yang ada: ${[...def.fields].join(", ")}`
        );
      }
    }
  }

  assert.deepEqual(masalah, [], `\n${masalah.join("\n")}\n`);
});

test("penjaga ini benar-benar memeriksa sesuatu, bukan lulus karena tidak menemukan apa-apa", () => {
  // Tanpa uji ini, penjaga di atas bisa diam-diam berhenti bekerja (mis.
  // regexnya tidak cocok lagi setelah gaya penulisan berubah) dan tetap
  // "lulus" walau tidak memeriksa satu baris pun.
  const model = bacaModel();
  const temuan = kumpulkanOrderBy(SUMBER[0], model);
  assert.ok(temuan.length >= 4, `harus menemukan beberapa orderBy, dapat ${temuan.length}`);

  assert.ok(model.Conversation, "model Conversation harus terbaca dari schema");
  assert.ok(
    model.Conversation.fields.has("lastMessageAt"),
    "Conversation harus punya lastMessageAt — kolom yang BENAR untuk mengurutkan percakapan",
  );
  assert.ok(
    !model.Conversation.fields.has("updatedAt"),
    "Conversation TIDAK punya updatedAt — inilah kolom karangan yang dulu bikin broadcast gagal senyap",
  );
});

test("relasi bersarang ikut terbaca, supaya tidak salah tuduh", () => {
  // orderBy milik relasi (mis. customer -> conversations -> lastMessageAt)
  // harus dicocokkan ke model RELASINYA, bukan ke model induk. Versi awal
  // penjaga ini salah di sini dan melaporkan kesalahan palsu.
  const model = bacaModel();
  assert.equal(model.Customer.relasi.conversations, "Conversation");
  assert.equal(model.Conversation.relasi.messages, "Message");
  assert.equal(model.BroadcastTarget.relasi.campaign, "BroadcastCampaign");
});
