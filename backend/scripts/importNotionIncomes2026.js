// IMPOR SEKALI-JALAN — Incomes.csv Notion, HANYA baris yang BUKAN
// pembayaran pelanggan.
//
// KEPUTUSAN YANG SUDAH DISEPAKATI PEMILIK BISNIS (18 Sep 2026):
//
//  1. 924 dari 943 baris file ini berkategori "Pendapatan" dan isinya
//     pembayaran pelanggan ("Pembayaran Rahmat", "Pelunasan Nur Agustin",
//     dst) — SENGAJA TIDAK diimpor, sudah/akan tercatat lewat Order/
//     Payment CRM sendiri (keputusan lama importNotionSeptember2026.js
//     TERKONFIRMASI BENAR setelah ditinjau ulang seluruh file, bukan cuma
//     sampel 5 baris pertama). Skrip ini HANYA memproses 19 baris sisanya.
//  2. "Pinjaman MUF" & "INVES FARHAN" berlabel "Suntikan Modal" di Notion,
//     TAPI teks keterangannya jelas bilang pinjaman, dan pelunasannya
//     SUDAH tercatat sebagai "Pembayaran Pinjaman" (Utang Pihak Ketiga) di
//     import Expenses sebelumnya — diperlakukan simetris: utang, bukan
//     modal.
//  3. "juri suntik" (Juri = owner) — dikonfirmasi owner: ini utang
//     PERUSAHAAN KE Juri (dia yang menyuntikkan dana pribadi), bukan
//     modal. Sama seperti "Pinjaman Mat Juri" -> Utang Pihak Ketiga.
//  4. "Jan-Jun pelunasan Piutang Pasamebel" Rp40.422.000 — dikonfirmasi
//     owner: ini PENJUALAN PRODUK kasur baru lewat toko Pasamebel
//     (konsinyasi), bukan pelunasan pinjaman. -> Pendapatan Lain-lain
//     (FinOtherIncome), BUKAN Pendapatan Penjualan Produk (4-1200) —
//     sengaja dipisah supaya akun itu tetap 100% bisa ditelusuri balik ke
//     Order CRM (murni otomatis), tidak tercampur entri manual.
//  5. "Tarik Dana Rekening PT" Rp900.000 — dikonfirmasi owner: mutasi
//     internal PT Sano -> SANOBANK (bukan uang baru masuk). -> Transfer
//     Kas, BUKAN pemasukan.
//  6. "BALANCE" Rp835.845 — dikonfirmasi owner: plug lama dari awal
//     bisnis yang sumbernya sudah dicari dan tidak ketemu (sudah pernah
//     "dibalancing" manual). DISKIP — bukan transaksi yang bisa
//     ditelusuri, tidak layak dibawa ke sistem baru.
//  7. Baris tanpa rekening jelas (Notion "Untitled"/kosong) -> default PT
//     Sano, konsisten dengan aturan #7 di importNotionFullHistory2026.js.
//  8. Bunga bank ("Bunga PT Sano", "Bunga pt") -> Pendapatan Lain-lain.
//
// AMAN DIJALANKAN ULANG (idempoten). Default DRY-RUN — jalankan dengan
// `--apply` untuk benar-benar menulis ke database.
//
//   node backend/scripts/importNotionIncomes2026.js          # pratinjau
//   node backend/scripts/importNotionIncomes2026.js --apply  # eksekusi

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";
import { postOtherIncome, postCashTransfer } from "../src/services/finance/posting/cash.js";
import { resolveAccount, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { postJournal, findEntryByKey, generateDocumentNumber, toBookDate } from "../src/services/finance/journal.js";
import { toMoney } from "../src/services/finance/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "notion-data-2026");
const APPLY = process.argv.includes("--apply");
const IMPORT_TAG = "[IMPOR-NOTION-INCOMES-2026]";

function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function ddmmyyyyToIso(s) {
  const [dd, mm, yyyy] = s.trim().split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function idrToNumber(s) {
  return (s || "").replace(/[^\d]/g, "");
}

// "SANOBANK (https://app.notion.com/...)" -> "SANOBANK". "Untitled" dan
// string kosong dianggap sama-sama "tidak jelas" (poin #7).
function namaRekening(raw) {
  const nama = (raw || "").split("(")[0].trim();
  return nama && nama !== "Untitled" ? nama : "";
}

// Klasifikasi 19 baris bukan-Pendapatan berdasarkan teks Income persis —
// SENGAJA daftar eksplisit (bukan heuristik kategori Notion, yang ternyata
// tidak konsisten -- "Suntikan Modal" dipakai untuk pinjaman sungguhan,
// "Balance" dipakai untuk bunga bank DAN plug lama sekaligus). Match
// case-insensitive, exact setelah trim.
const KLASIFIKASI = new Map([
  ["pinjaman pasamebel", "PINJAMAN"],
  ["pinjaman pasamabel", "PINJAMAN"], // typo yang sama muncul di data asli
  ["pinjaman mat juri", "PINJAMAN"],
  ["pinjaman muf", "PINJAMAN"],
  ["inves farhan", "PINJAMAN"],
  ["juri suntik", "PINJAMAN"], // dikonfirmasi owner: utang ke Juri, bukan modal
  ["bunga pt sano", "BUNGA"],
  ["bunga pt", "BUNGA"],
  ["jan-jun pelunasan piutang pasamebel", "PRODUK_PASAMEBEL"],
  ["tarik dana rekening pt", "TRANSFER_PT_KE_SANOBANK"],
  ["balance", "SKIP_PLUG_LAMA"],
  ["pemasukan selisih", "SKIP_KOSONG"],
]);

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (pratinjau saja)"}\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi jurnal impor ini.");
  console.log(`Diatribusikan sebagai: ${admin.name} (${admin.id})\n`);

  const cashAccountRows = await prisma.finCashAccount.findMany({ where: { active: true }, select: { id: true, name: true, accountId: true } });
  const cashByName = new Map(cashAccountRows.map((c) => [c.name.trim().toUpperCase(), c]));
  const ALIAS = { "SANOBANK": "KEM - SANO BANK", "UANG KAS SANO": "UANG KAS SANO" };

  function resolveCash(name) {
    const raw = (name || "PT Sano").trim().toUpperCase() || "PT SANO";
    const found = cashByName.get(raw) || cashByName.get(ALIAS[raw]) || cashByName.get("PT SANO");
    if (!found) throw new Error(`Rekening "${name}" tidak ditemukan. Rekening yang ada: ${[...cashByName.keys()].join(", ")}`);
    return found;
  }

  const rows = parseCsv(fs.readFileSync(path.join(DATA_DIR, "Incomes 2d0cb10a4ce481aab486f25065ab91f7_all.csv"), "utf8").replace(/^﻿/, ""));
  console.log(`=== Incomes.csv (${rows.length} baris di file, 924 baris "Pendapatan" DILEWATI karena itu pembayaran pelanggan) ===\n`);

  const stats = { pinjaman: 0, pinjamanSkip: 0, otherIncome: 0, otherIncomeSkip: 0, transfer: 0, transferSkip: 0, skip: 0, tidakDikenal: 0 };
  const totalPerJenis = { pinjaman: 0, bunga: 0, produk: 0, transfer: 0 };

  for (const [i, row] of rows.entries()) {
    const keterangan = (row.Income || "").trim();
    const category = (row.category || "").trim();
    if (category === "Pendapatan") continue; // pembayaran pelanggan, bukan urusan skrip ini

    const nominalStr = idrToNumber(row.Amount);
    if (!keterangan || !nominalStr || nominalStr === "0") continue; // baris kosong/tanpa nominal

    const jenis = KLASIFIKASI.get(keterangan.toLowerCase());
    if (!jenis) {
      console.log(`  ⚠️ TIDAK DIKENAL, dilewati: ${row.Date} "${keterangan}" Rp${nominalStr} (kategori Notion: "${category}")`);
      stats.tidakDikenal++;
      continue;
    }
    if (jenis === "SKIP_PLUG_LAMA" || jenis === "SKIP_KOSONG") { stats.skip++; continue; }

    const isoDate = ddmmyyyyToIso(row.Date);
    const bookDate = toBookDate(isoDate);
    const nominal = nominalStr;
    const rekAsal = namaRekening(row.Accounts);

    try {
      if (jenis === "PINJAMAN") {
        const cash = resolveCash(rekAsal);
        const idemKey = `IMPORT_INCOMES2026:PINJAMAN:${i}`;
        const sudah = await findEntryByKey(prisma, idemKey);
        if (sudah) { stats.pinjamanSkip++; continue; }
        console.log(`  [PINJAMAN] ${isoDate} ${keterangan} — Rp${nominal} (Dr ${cash.name} / Cr Utang Pihak Ketiga)`);
        totalPerJenis.pinjaman += Number(nominal);
        if (APPLY) {
          await prisma.$transaction(async (tx) => {
            const utangPihakKetiga = await resolveAccount(tx, SYSTEM_KEYS.UTANG_PIHAK_KETIGA);
            await postJournal(tx, {
              date: isoDate, description: `${IMPORT_TAG} ${keterangan}`, source: "MANUAL", idempotencyKey: idemKey, userId: admin.id,
              lines: [
                { accountId: cash.accountId, debit: toMoney(nominal), description: `Uang masuk — ${cash.name}`, cashAccountId: cash.id },
                { accountId: utangPihakKetiga.id, credit: toMoney(nominal), description: `Pinjaman diterima — ${keterangan}` },
              ],
            });
          }, { timeout: 20_000 });
        }
        stats.pinjaman++;
      } else if (jenis === "BUNGA" || jenis === "PRODUK_PASAMEBEL") {
        const cash = resolveCash(rekAsal);
        const existing = await prisma.finOtherIncome.findFirst({ where: { date: bookDate, amount: toMoney(nominal), description: keterangan }, select: { id: true } });
        if (existing) { stats.otherIncomeSkip++; continue; }
        console.log(`  [PEMASUKAN LAIN] ${isoDate} ${keterangan} — Rp${nominal} (${cash.name})`);
        totalPerJenis[jenis === "BUNGA" ? "bunga" : "produk"] += Number(nominal);
        if (APPLY) {
          const pendapatanLain = await prisma.$transaction((tx) => resolveAccount(tx, SYSTEM_KEYS.PENDAPATAN_LAIN));
          const incomeNumber = await prisma.$transaction((tx) => generateDocumentNumber(tx, "INC", bookDate));
          const created = await prisma.finOtherIncome.create({
            data: {
              incomeNumber, date: bookDate, amount: toMoney(nominal), description: keterangan,
              accountId: pendapatanLain.id, cashAccountId: cash.id, createdById: admin.id,
              notes: `${IMPORT_TAG} kategori Notion asal: ${category}`,
            },
            select: { id: true },
          });
          await prisma.$transaction((tx) => postOtherIncome(tx, { incomeId: created.id, userId: admin.id }), { timeout: 20_000 });
        }
        stats.otherIncome++;
      } else if (jenis === "TRANSFER_PT_KE_SANOBANK") {
        const ptSano = resolveCash("PT Sano");
        const sanobank = resolveCash("SANOBANK");
        const existing = await prisma.finCashTransfer.findFirst({ where: { date: bookDate, amount: toMoney(nominal), fromAccountId: ptSano.id, toAccountId: sanobank.id }, select: { id: true } });
        if (existing) { stats.transferSkip++; continue; }
        console.log(`  [TRANSFER] ${isoDate} ${keterangan} — Rp${nominal} (PT Sano → ${sanobank.name})`);
        totalPerJenis.transfer += Number(nominal);
        if (APPLY) {
          const transferNumber = await prisma.$transaction((tx) => generateDocumentNumber(tx, "TRF", bookDate));
          const created = await prisma.finCashTransfer.create({
            data: {
              transferNumber, date: bookDate, amount: toMoney(nominal),
              fromAccountId: ptSano.id, toAccountId: sanobank.id, createdById: admin.id,
              notes: `${IMPORT_TAG} ${keterangan}`,
            },
            select: { id: true },
          });
          await prisma.$transaction((tx) => postCashTransfer(tx, { transferId: created.id, userId: admin.id }), { timeout: 20_000 });
        }
        stats.transfer++;
      }
    } catch (e) {
      console.error(`  ERROR baris ${i} (${keterangan}): ${e.message}`);
    }
  }

  console.log("\n=== RINGKASAN ===");
  console.log(`Pinjaman diterima (-> Utang Pihak Ketiga) : ${stats.pinjaman} (dilewati: ${stats.pinjamanSkip}) — Rp${totalPerJenis.pinjaman.toLocaleString("id-ID")}`);
  console.log(`Pemasukan lain (bunga + produk Pasamebel)  : ${stats.otherIncome} (dilewati: ${stats.otherIncomeSkip}) — bunga Rp${totalPerJenis.bunga.toLocaleString("id-ID")}, produk Rp${totalPerJenis.produk.toLocaleString("id-ID")}`);
  console.log(`Transfer internal (PT Sano -> SANOBANK)    : ${stats.transfer} (dilewati: ${stats.transferSkip}) — Rp${totalPerJenis.transfer.toLocaleString("id-ID")}`);
  console.log(`Dilewati sesuai keputusan (BALANCE/kosong) : ${stats.skip}`);
  console.log(`Tidak dikenal (perlu ditinjau manual)      : ${stats.tidakDikenal}`);

  if (!APPLY) console.log("\nIni baru DRY-RUN. Jalankan ulang dengan --apply untuk benar-benar menulis ke database.");
}

main()
  .catch((e) => {
    console.error("SCRIPT ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
