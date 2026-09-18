// IMPOR SEKALI-JALAN — histori PENUH pengeluaran Notion (15 Des 2025 s/d
// tanggal export), penerus importNotionSeptember2026.js.
//
// KEPUTUSAN YANG SUDAH DISEPAKATI PEMILIK BISNIS (18 Sep 2026) — jangan
// diubah tanpa konfirmasi ulang. INI MEREVISI keputusan #1 script lama:
//
//  1. ⚠️ REVISI: keputusan lama "histori sebelum 1 Sept tidak diimpor"
//     DICABUT — owner sekarang minta BACKFILL PENUH dari 15 Des 2025.
//     Tidak ada filter tanggal di script ini sama sekali; SELURUH baris di
//     file diproses. Baris 31 Agu–17 Sep 2026 yang SUDAH pernah masuk lewat
//     importNotionSeptember2026.js otomatis DILEWATI oleh pengecekan
//     idempoten (match persis date+amount+description) — aman dijalankan
//     walau overlap dengan histori yang sudah diimpor duluan.
//  2. Kasbon & Incomes.csv TIDAK ikut di script ini — dibahas terpisah
//     (lihat percakapan 18 Sep 2026; Incomes.csv ternyata isinya pinjaman/
//     suntikan modal, BUKAN pembayaran pelanggan seperti dugaan lama).
//  3. Bahan baku manual & aset SEKARANG lewat tab PEMBELIAN (FinPurchase),
//     BUKAN FinExpense lagi — tab itu belum ada saat script lama ditulis.
//     Baris "Belanja Bahan Baku/Kain/Busa/PE Enchasement/Plastik PE/Kayu/
//     Kain Tabeng/List Kain" -> FinPurchaseCategory BAHAN_BAKU_MANUAL.
//     Baris "Aset" (tunggal, bukan "Aset Tak Berwujud") -> ASET_PERALATAN.
//     Baris "Aset Tak Berwujud" -> ASET_TAK_BERWUJUD (dulu jurnal manual
//     langsung di script lama; sekarang py FinPurchase juga, dapat nomor
//     dokumen PUR & tampil di tab Pembelian, bukan cuma baris jurnal polos).
//  4. "Pembayaran Pinjaman" -> pelunasan Utang Pihak Ketiga (2-1600) lewat
//     JURNAL MANUAL LANGSUNG (bukan Expense atau Purchase — ini bukan beban
//     maupun pembelian, murni pemindahan saldo kewajiban). BUKAN beban.
//  5. Baris tanpa rekening tercatat (Account kosong) -> default PT Sano.
//  6. Baris betul-betul kosong (tanpa keterangan & tanpa nominal — sampah
//     baris Notion) -> DILEWATI, tidak dihitung error.
//  7. Tag Sub Category GANDA ("Ads Meta, Ads Google" dsb, dari multi-select
//     Notion) -> dipetakan dari TAG PERTAMA saja (sebelum koma pertama).
//     Ini simplifikasi sengaja: cuma ~15 dari 2600+ baris yang punya tag
//     ganda, dan meninjau tiap kombinasi manual tidak sepadan.
//
// AMAN DIJALANKAN ULANG (idempoten): setiap baris dicek dulu apakah sudah
// pernah diimpor sebelum menulis apa pun. Default DRY-RUN — jalankan
// dengan `--apply` untuk benar-benar menulis ke database.
//
//   node backend/scripts/importNotionFullHistory2026.js          # pratinjau
//   node backend/scripts/importNotionFullHistory2026.js --apply  # eksekusi

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";
import { postExpenseApproved } from "../src/services/finance/posting/expense.js";
import { postPurchaseApproved } from "../src/services/finance/posting/purchase.js";
import { resolveAccount, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { postJournal, findEntryByKey, generateDocumentNumber, toBookDate } from "../src/services/finance/journal.js";
import { toMoney } from "../src/services/finance/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "notion-data-2026");
const APPLY = process.argv.includes("--apply");
const IMPORT_TAG = "[IMPOR-NOTION-FULLHIST-2026]";

// ── Parser CSV — quote-aware, TERMASUK newline di dalam field berkutip
//    (beda dari parser baris-per-baris script lama; export Notion yang
//    lebih besar ini lebih aman diasumsikan bisa punya sel multi-baris). ──
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
  return rows.slice(1)
    .filter((r) => r.length > 1 || r[0])
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function readCsv(filename) {
  return parseCsv(fs.readFileSync(path.join(DATA_DIR, filename), "utf8").replace(/^﻿/, ""));
}

function ddmmyyyyToIso(s) {
  const [dd, mm, yyyy] = s.trim().split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function idrToNumber(s) {
  return s.replace(/[^\d]/g, "");
}

// Normalisasi keterangan untuk pengecekan duplikat — export Notion yang
// beda waktu ternyata TIDAK konsisten tanda baca/kapitalisasi untuk baris
// yang SAMA persis (mis. "Triplek 6ml, 2lbr" di file ini vs "Triplek 6ml
// 2lbr" yang sudah terlanjur masuk lewat importNotionSeptember2026.js —
// koma dihilangkan, ada juga yang beda kapitalisasi huruf pertama).
// Match PERSIS (tanpa normalisasi) akan lolos sebagai "baris baru" dan
// DOBEL-INPUT transaksi yang sebenarnya sudah tercatat. date+amount+
// deskripsi-ternormalisasi jauh lebih tahan banting untuk itu, dengan
// risiko kebalikannya (menyamakan 2 transaksi beda yang kebetulan sama
// tanggal+nominal+kata-kata) sudah dicek manual saat menulis skrip ini —
// TIDAK ditemukan tabrakan asli TERNORMALISASI di data historis.
function normalisasiKeterangan(s) {
  return s.toLowerCase().replace(/[.,\-/()]/g, " ").replace(/\s+/g, " ").trim();
}

// ── Pemetaan Sub Category Notion -> kode Kategori Biaya (FinExpense) ───────
const KATEGORI_MAP = {
  "Bensin": "BBM",
  "Etoll": "TOL",
  "Biaya Lainnya": "LAIN_LAIN",
  "Belanja Lain-Lain": "LAIN_LAIN",
  "Aplikasi": "LANGGANAN_APLIKASI",
  "Fee Part Time": "GAJI_KARYAWAN",
  "Gaji": "GAJI_KARYAWAN",
  "Operasional Meeting/Trip": "OPS_MEETING",
  "Ongkos Lainnya": "KURIR_EKSTERNAL",
  "Perlengkapan": "PERLENGKAPAN",
  "Peralatan": "PERLENGKAPAN",
  "Listrik": "UTILITAS",
  "BO Office": "PERLENGKAPAN",
  // "BO Produksi" = biaya operasional kecil produksi (galon, es batu, bensin
  // bersihin alat, dll — lihat contoh baris) -> overhead produksi, BUKAN
  // "Lain-lain" umum seperti di script lama (perbaikan, bukan revisi paksa).
  "BO Produksi": "OVERHEAD_PRODUKSI",
  "Ads Meta": "IKLAN",
  "Ads Google": "IKLAN",
  "Ads TikTok": "IKLAN",
  "Ads Instagram Boost Post": "IKLAN",
  "Meta": "IKLAN", // shorthand "Ads Meta" yang ketinggalan prefix-nya
  "": "LAIN_LAIN",
};

// Sub Category -> kode FinPurchaseCategory (tab Pembelian, BUKAN Pengeluaran).
const PEMBELIAN_MAP = {
  "Belanja Bahan Baku": "BAHAN_BAKU_MANUAL",
  "Kain": "BAHAN_BAKU_MANUAL",
  "Busa": "BAHAN_BAKU_MANUAL",
  "PE Enchasement": "BAHAN_BAKU_MANUAL",
  "Plastik PE": "BAHAN_BAKU_MANUAL",
  "Kayu": "BAHAN_BAKU_MANUAL",
  "Kain Tabeng": "BAHAN_BAKU_MANUAL",
  "List Kain": "BAHAN_BAKU_MANUAL",
  "Aset": "ASET_PERALATAN",
  "Aset Tak Berwujud": "ASET_TAK_BERWUJUD",
};

// Sub Category yang BUKAN Expense maupun Purchase — pemindahan saldo
// kewajiban murni, ditangani jurnal manual langsung.
const SUBCATEGORY_PINJAMAN = "Pembayaran Pinjaman";

/** Tag pertama dari multi-select Notion ("Ads Meta, Ads Google" -> "Ads Meta"). */
function tagPertama(subCategory) {
  return (subCategory || "").split(",")[0].trim();
}

function kategoriKode(subCategory, keterangan) {
  const s = tagPertama(subCategory);
  if (s === "Maintanance, Upgrade Alat" || s === "Maintanance" /* jaga-jaga kalau terpotong koma */) {
    const k = keterangan.toLowerCase();
    if (/mobil|zae|zab|motor|vario/.test(k)) return "SERVIS_KENDARAAN";
    return "MAINT_MESIN";
  }
  return KATEGORI_MAP[s] || null; // null = tidak dikenal, ditangani caller
}

function pembelianKode(subCategory) {
  return PEMBELIAN_MAP[tagPertama(subCategory)] || null;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (pratinjau saja)"}\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi jurnal impor ini.");
  console.log(`Diatribusikan sebagai: ${admin.name} (${admin.id})\n`);

  const cashAccountRows = await prisma.finCashAccount.findMany({ where: { active: true }, select: { id: true, name: true, accountId: true } });
  console.log("Rekening kas/bank yang ditemukan:", cashAccountRows.map((c) => c.name).join(", ") || "(TIDAK ADA!)");
  const cashByName = new Map(cashAccountRows.map((c) => [c.name.trim().toUpperCase(), c]));

  // Nama rekening di export Notion tidak selalu identik dengan nama
  // FinCashAccount produksi — alias eksplisit, bukan tebakan fuzzy-match.
  const ALIAS = { "SANOBANK": "KEM - SANO BANK", "UANG KAS SANO": "UANG KAS SANO" };

  function resolveCash(name) {
    const raw = (name || "PT Sano").trim().toUpperCase() || "PT SANO";
    const found = cashByName.get(raw) || cashByName.get(ALIAS[raw]) || cashByName.get("PT SANO");
    if (!found) {
      throw new Error(
        `Rekening "${name || "(kosong -> default PT Sano)"}" tidak ditemukan di FinCashAccount. Rekening yang ada: ${[...cashByName.keys()].join(", ")}`
      );
    }
    return found;
  }

  // Verifikasi 3 rekening wajib ADA sebelum lanjut apa pun (poin #2 dari
  // permintaan) — gagal cepat & jelas kalau ada yang belum terdaftar.
  for (const nama of ["PT Sano", "SANOBANK", "UANG KAS SANO"]) {
    try {
      const c = resolveCash(nama);
      console.log(`  ✓ "${nama}" -> FinCashAccount "${c.name}"`);
    } catch (e) {
      console.error(`  ✗ "${nama}": ${e.message}`);
      throw new Error("Rekening wajib belum lengkap — pasang dulu di Finance > Kas & Bank sebelum lanjut.");
    }
  }
  console.log();

  const kategoriCodes = [...new Set([...Object.values(KATEGORI_MAP), "SERVIS_KENDARAAN", "MAINT_MESIN", "OVERHEAD_PRODUKSI"])].filter(Boolean);
  const kategoriRows = await prisma.finExpenseCategory.findMany({
    where: { code: { in: kategoriCodes }, active: true },
    select: { id: true, code: true, division: true },
  });
  const kategoriByCode = new Map(kategoriRows.map((k) => [k.code, k]));
  const kategoriHilang = kategoriCodes.filter((c) => !kategoriByCode.has(c));
  if (kategoriHilang.length) {
    throw new Error(`Kategori BIAYA belum terpasang: ${kategoriHilang.join(", ")}. Jalankan "Pasang Akun Bawaan" dulu.`);
  }

  const pembelianCodes = [...new Set(Object.values(PEMBELIAN_MAP))];
  const pembelianRows = await prisma.finPurchaseCategory.findMany({
    where: { code: { in: pembelianCodes }, active: true },
    select: { id: true, code: true },
  });
  const pembelianByCode = new Map(pembelianRows.map((k) => [k.code, k]));
  const pembelianHilang = pembelianCodes.filter((c) => !pembelianByCode.has(c));
  if (pembelianHilang.length) {
    throw new Error(`Kategori PEMBELIAN belum terpasang: ${pembelianHilang.join(", ")}. Jalankan "Pasang Akun Bawaan" dulu.`);
  }

  // Preload SELURUH FinExpense & FinPurchase yang sudah ada -> index
  // in-memory ternormalisasi (date|amount|deskripsi-ternormalisasi). Jauh
  // lebih murah daripada findFirst() per baris (2600+ query), dan sekalian
  // memungkinkan normalisasi teks (lihat komentar normalisasiKeterangan).
  const existingExpenseKeys = new Set(
    (await prisma.finExpense.findMany({ select: { date: true, amount: true, description: true } }))
      .map((e) => `${e.date.toISOString().slice(0, 10)}|${Number(e.amount)}|${normalisasiKeterangan(e.description)}`)
  );
  const existingPurchaseKeys = new Set(
    (await prisma.finPurchase.findMany({ select: { date: true, amount: true, description: true } }))
      .map((p) => `${p.date.toISOString().slice(0, 10)}|${Number(p.amount)}|${normalisasiKeterangan(p.description)}`)
  );
  console.log(`Pengeluaran sudah ada di database: ${existingExpenseKeys.size} baris`);
  console.log(`Pembelian sudah ada di database: ${existingPurchaseKeys.size} baris\n`);

  const stats = {
    expense: 0, expenseSkip: 0,
    purchase: 0, purchaseSkip: 0,
    pinjaman: 0, pinjamanSkip: 0,
    kosong: 0, error: 0,
  };
  const takDikenal = new Map(); // subCategory tak dikenal -> jumlah baris
  const totalPerRekening = new Map(); // nama rekening -> { expense, purchase, pinjaman }

  function tambahTotal(namaRekening, jenis, nominal) {
    const cur = totalPerRekening.get(namaRekening) || { expense: 0, purchase: 0, pinjaman: 0 };
    cur[jenis] += Number(nominal);
    totalPerRekening.set(namaRekening, cur);
  }

  const rows = readCsv("Expenses_small.csv");
  console.log(`=== Pengeluaran + Pembelian + Pinjaman (${rows.length} baris di file) ===\n`);

  for (const [i, row] of rows.entries()) {
    const keterangan = (row.Expense || "").trim();
    const nominalStr = idrToNumber(row.Amount || "");
    if (!keterangan || !nominalStr || nominalStr === "0") { stats.kosong++; continue; }

    const isoDate = ddmmyyyyToIso(row.Date);
    const nominal = nominalStr;
    const subCategory = (row["Sub Category"] || "").trim();
    const rekeningNama = (row.Account || "").trim();

    try {
      const cash = resolveCash(rekeningNama);

      // ── Kasus khusus: Pembayaran Pinjaman (jurnal manual) ──────────────
      if (tagPertama(subCategory) === SUBCATEGORY_PINJAMAN) {
        const idemKey = `IMPORT_FULLHIST2026:PINJAMAN:${i}`;
        const sudah = await findEntryByKey(prisma, idemKey);
        if (sudah) { stats.pinjamanSkip++; continue; }
        console.log(`  [PINJAMAN] ${isoDate} ${keterangan} — Rp${nominal} (Dr Utang Pihak Ketiga / Cr ${cash.name})`);
        tambahTotal(cash.name, "pinjaman", nominal);
        if (APPLY) {
          await prisma.$transaction(async (tx) => {
            const utangPihakKetiga = await resolveAccount(tx, SYSTEM_KEYS.UTANG_PIHAK_KETIGA);
            await postJournal(tx, {
              date: isoDate, description: `${IMPORT_TAG} ${keterangan}`, source: "MANUAL", idempotencyKey: idemKey, userId: admin.id,
              lines: [
                { accountId: utangPihakKetiga.id, debit: toMoney(nominal), description: `Pelunasan — ${keterangan}` },
                { accountId: cash.accountId, credit: toMoney(nominal), description: `Uang keluar — ${cash.name}`, cashAccountId: cash.id },
              ],
            });
          }, { timeout: 20_000 });
        }
        stats.pinjaman++;
        continue;
      }

      // ── Bahan baku manual / aset / aset tak berwujud -> Pembelian ──────
      const kodePembelian = pembelianKode(subCategory);
      if (kodePembelian) {
        const kategori = pembelianByCode.get(kodePembelian);
        const bookDate = toBookDate(isoDate);
        const dupKey = `${isoDate}|${Number(nominal)}|${normalisasiKeterangan(keterangan)}`;
        if (existingPurchaseKeys.has(dupKey)) { stats.purchaseSkip++; continue; }

        console.log(`  [BELI] ${isoDate} ${keterangan} — Rp${nominal} (${kodePembelian}, ${cash.name})`);
        tambahTotal(cash.name, "purchase", nominal);
        if (APPLY) {
          const purchaseNumber = await prisma.$transaction((tx) => generateDocumentNumber(tx, "PUR", bookDate));
          const created = await prisma.finPurchase.create({
            data: {
              purchaseNumber, date: bookDate, amount: toMoney(nominal), description: keterangan,
              categoryId: kategori.id,
              division: kodePembelian === "ASET_TAK_BERWUJUD" ? "UMUM" : "PRODUKSI",
              mode: "LANGSUNG",
              cashAccountId: cash.id,
              status: "DIBAYAR",
              submittedAt: bookDate, approvedAt: bookDate, approvedById: admin.id,
              paidAt: bookDate, paidById: admin.id,
              createdById: admin.id,
              notes: `${IMPORT_TAG} sub-category asal: ${subCategory || "(kosong)"}`,
            },
            select: { id: true },
          });
          await prisma.$transaction((tx) => postPurchaseApproved(tx, { purchaseId: created.id, userId: admin.id }), { timeout: 20_000 });
        }
        existingPurchaseKeys.add(dupKey); // cegah dobel dalam satu run kalau CSV sendiri punya baris kembar
        stats.purchase++;
        continue;
      }

      // ── Pengeluaran biasa ───────────────────────────────────────────────
      const kode = kategoriKode(subCategory, keterangan);
      if (!kode) {
        takDikenal.set(subCategory, (takDikenal.get(subCategory) || 0) + 1);
      }
      const kodeFinal = kode || "LAIN_LAIN";
      const kategori = kategoriByCode.get(kodeFinal);
      const bookDate = toBookDate(isoDate);

      const dupKey = `${isoDate}|${Number(nominal)}|${normalisasiKeterangan(keterangan)}`;
      if (existingExpenseKeys.has(dupKey)) { stats.expenseSkip++; continue; }

      console.log(`  [EXP] ${isoDate} ${keterangan} — Rp${nominal} (${kodeFinal}, ${cash.name})`);
      tambahTotal(cash.name, "expense", nominal);
      if (APPLY) {
        const expenseNumber = await prisma.$transaction((tx) => generateDocumentNumber(tx, "EXP", bookDate));
        const created = await prisma.finExpense.create({
          data: {
            expenseNumber, date: bookDate, amount: toMoney(nominal), description: keterangan,
            categoryId: kategori.id, division: kategori.division, mode: "LANGSUNG",
            cashAccountId: cash.id, status: "DIBAYAR",
            submittedAt: bookDate, approvedAt: bookDate, approvedById: admin.id,
            paidAt: bookDate, paidById: admin.id, createdById: admin.id,
            notes: `${IMPORT_TAG} sub-category asal: ${subCategory || "(kosong)"}`,
          },
          select: { id: true },
        });
        await prisma.$transaction((tx) => postExpenseApproved(tx, { expenseId: created.id, userId: admin.id }), { timeout: 20_000 });
      }
      existingExpenseKeys.add(dupKey);
      stats.expense++;
    } catch (e) {
      stats.error++;
      console.error(`  ERROR baris ${i} (${keterangan}): ${e.message}`);
    }
  }

  console.log("\n=== RINGKASAN ===");
  console.log(`Pengeluaran (Pengeluaran & Reimbursement) : ${stats.expense} (dilewati karena sudah ada: ${stats.expenseSkip})`);
  console.log(`Pembelian (bahan baku/aset/DP)            : ${stats.purchase} (dilewati karena sudah ada: ${stats.purchaseSkip})`);
  console.log(`Pelunasan pinjaman                        : ${stats.pinjaman} (dilewati karena sudah ada: ${stats.pinjamanSkip})`);
  console.log(`Baris kosong (dilewati, bukan error)      : ${stats.kosong}`);
  console.log(`Error                                     : ${stats.error}`);

  if (takDikenal.size) {
    console.log("\n⚠️  Sub Category TIDAK DIKENAL (dibukukan ke LAIN_LAIN, tinjau manual kalau perlu):");
    for (const [k, v] of [...takDikenal.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v}x  "${k}"`);
    }
  }

  console.log("\n=== TOTAL PER REKENING (cross-check vs rollup Notion) ===");
  for (const [nama, t] of totalPerRekening.entries()) {
    const total = t.expense + t.purchase + t.pinjaman;
    console.log(`  ${nama}: Pengeluaran Rp${t.expense.toLocaleString("id-ID")} + Pembelian Rp${t.purchase.toLocaleString("id-ID")} + Pinjaman Rp${t.pinjaman.toLocaleString("id-ID")} = Rp${total.toLocaleString("id-ID")}`);
  }

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
