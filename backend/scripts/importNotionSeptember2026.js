// IMPOR SEKALI-JALAN — data historis Notion untuk September 2026, sebagai
// bagian dari cutover Notion -> Finance Workspace per 1 September 2026.
//
// KEPUTUSAN YANG SUDAH DISEPAKATI PEMILIK BISNIS (17 Sep 2026) — jangan
// diubah tanpa konfirmasi ulang:
//
//  1. Histori SEBELUM 1 Sept 2026 TIDAK diimpor sama sekali — Notion tetap
//     jadi arsip untuk periode itu. Baris September ditentukan memakai
//     kolom "Expense This Month" bawaan Notion sendiri (formula Notion,
//     bukan tebakan kita) untuk Expenses & Kasbon.
//  2. Pembayaran pelanggan (Incomes.csv, kategori "Pendapatan") SENGAJA
//     TIDAK diimpor — itu sudah/akan tercatat lewat Order/Payment CRM
//     sendiri. Modul Sales/CRM/Omnichannel TIDAK disentuh skrip ini sama
//     sekali, sesuai instruksi eksplisit pemilik bisnis.
//  3. Per 17 Sep 2026, Gudang & Iklan CRM belum dipakai SAMA SEKALI
//     (dikonfirmasi pemilik bisnis) — jadi baris "Belanja Bahan Baku" &
//     "Ads *" AMAN diimpor sebagai Pengeluaran manual, tidak ada resiko
//     dobel-catat SAAT INI. Begitu modul itu mulai dipakai untuk periode
//     berikutnya, baris sejenis tidak boleh lagi diimpor manual — itu di
//     luar tanggung jawab skrip sekali-jalan ini.
//  4. Kasbon = uang muka gaji karyawan -> Piutang Karyawan (1-1350, lihat
//     services/finance/posting/kasbon.js). BUKAN beban.
//  5. "Pembayaran Pinjaman" -> pelunasan Utang Pihak Ketiga (2-1600).
//     BUKAN beban (kecuali ada baris fee/bunga terpisah, yang tetap masuk
//     beban seperti biasa).
//  6. "Aset Tak Berwujud" (paten/HAKI/domain) -> dikapitalisasi ke Aset
//     Tak Berwujud (1-2300), bukan langsung dibebankan.
//  7. Baris tanpa rekening tercatat (Account kosong) -> default PT Sano.
//
// AMAN DIJALANKAN ULANG (idempoten): setiap baris dicek dulu apakah sudah
// pernah diimpor (lihat isAlreadyImported / findEntryByKey di masing-masing
// fungsi posting) sebelum menulis apa pun. Default DRY-RUN — jalankan
// dengan `--apply` untuk benar-benar menulis ke database.
//
//   node backend/scripts/importNotionSeptember2026.js          # pratinjau
//   node backend/scripts/importNotionSeptember2026.js --apply  # eksekusi

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";
import { postExpenseApproved } from "../src/services/finance/posting/expense.js";
import { postKasbonDiberikan } from "../src/services/finance/posting/kasbon.js";
import { resolveAccount, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { postJournal, findEntryByKey, generateDocumentNumber, toBookDate } from "../src/services/finance/journal.js";
import { toMoney } from "../src/services/finance/money.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "notion-september-2026");
const APPLY = process.argv.includes("--apply");
const IMPORT_TAG = "[IMPOR-NOTION-SEPT2026]";

// ── Parser CSV minimal (cukup untuk file yang kita tulis sendiri: koma
//    pemisah, field ber-koma dibungkus tanda kutip ganda, tidak ada kutip
//    tersarang). ──────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') inQuotes = false;
        else cur += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function readCsv(filename) {
  return parseCsv(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function ddmmyyyyToIso(s) {
  const [dd, mm, yyyy] = s.trim().split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function idrToNumber(s) {
  return s.replace(/[^\d]/g, "");
}

// ── Pemetaan Sub Category Notion -> kode Kategori Biaya ────────────────────
const KATEGORI_MAP = {
  "Bensin": "BBM",
  "Etoll": "TOL",
  "Biaya Lainnya": "LAIN_LAIN",
  "Belanja Lain-Lain": "LAIN_LAIN",
  "Belanja Bahan Baku": "BAHAN_BAKU_MANUAL",
  "Kain": "BAHAN_BAKU_MANUAL",
  "Busa": "BAHAN_BAKU_MANUAL",
  "PE Enchasement": "BAHAN_BAKU_MANUAL",
  "Aplikasi": "LANGGANAN_APLIKASI",
  "Fee Part Time": "GAJI_KARYAWAN",
  "Gaji": "GAJI_KARYAWAN",
  "Operasional Meeting/Trip": "OPS_MEETING",
  "Ongkos Lainnya": "KURIR_EKSTERNAL",
  "Perlengkapan": "PERLENGKAPAN",
  "Peralatan": "PERLENGKAPAN",
  "Listrik": "UTILITAS",
  "BO Office": "PERLENGKAPAN",
  "BO Produksi": "LAIN_LAIN",
  "Ads Meta": "IKLAN",
  "Ads Google": "IKLAN",
  "Ads TikTok": "IKLAN",
  "": "LAIN_LAIN",
};

// Dua kejadian yang BUKAN pengeluaran biasa — ditangani via jurnal langsung,
// bukan lewat FinExpense/Kategori Biaya sama sekali.
const SUBCATEGORY_KHUSUS = new Set(["Pembayaran Pinjaman", "Aset Tak Berwujud"]);

function kategoriKode(subCategory, keterangan) {
  const s = (subCategory || "").trim();
  if (s === "Maintanance, Upgrade Alat") {
    // Notion menggabungkan kendaraan & mesin produksi di satu tag yang sama
    // — pisahkan berdasar kata kunci di keterangan (mobil/plat vs mesin).
    const k = keterangan.toLowerCase();
    if (/mobil|zae|zab|motor|vario/.test(k)) return "SERVIS_KENDARAAN";
    return "MAINT_MESIN";
  }
  return KATEGORI_MAP[s] || "LAIN_LAIN";
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (pratinjau saja)"}\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi jurnal impor ini.");
  console.log(`Diatribusikan sebagai: ${admin.name} (${admin.id})\n`);

  const cashAccountRows = await prisma.finCashAccount.findMany({ where: { active: true }, select: { id: true, name: true, accountId: true } });
  console.log("Rekening kas/bank yang ditemukan:", cashAccountRows.map((c) => c.name).join(", ") || "(tidak ada!)");
  const cashByName = new Map(cashAccountRows.map((c) => [c.name.trim().toUpperCase(), c]));

  // Nama rekening di export Notion ("SANOBANK") tidak selalu sama persis
  // dengan nama rekening yang sudah didaftarkan di FinCashAccount produksi
  // ("KEM - Sano Bank") — alias eksplisit, bukan tebakan fuzzy-match.
  const ALIAS = { "SANOBANK": "KEM - SANO BANK" };

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

  const kategoriCodes = [...new Set([...Object.values(KATEGORI_MAP), "SERVIS_KENDARAAN", "MAINT_MESIN", "IKLAN"])];
  const kategoriRows = await prisma.finExpenseCategory.findMany({
    where: { code: { in: kategoriCodes }, active: true },
    select: { id: true, code: true, division: true },
  });
  const kategoriByCode = new Map(kategoriRows.map((k) => [k.code, k]));
  const kategoriHilang = kategoriCodes.filter((c) => !kategoriByCode.has(c));
  if (kategoriHilang.length) {
    throw new Error(`Kategori biaya belum terpasang: ${kategoriHilang.join(", ")}. Jalankan "Pasang Akun Bawaan" dulu.`);
  }

  const stats = { expense: 0, expenseSkip: 0, kasbon: 0, kasbonSkip: 0, pinjaman: 0, aset: 0, error: 0 };

  // ── EXPENSES ──────────────────────────────────────────────────────────
  const expenseRows = readCsv("expenses_september.csv");
  console.log(`\n=== Pengeluaran (${expenseRows.length} baris di file) ===`);

  await prisma.$transaction(
    async (tx) => {
      for (const [i, row] of expenseRows.entries()) {
        const keterangan = row.Expense.trim();
        const isoDate = ddmmyyyyToIso(row.Date);
        const nominal = idrToNumber(row.Amount);
        const subCategory = row.SubCategory.trim();
        const rekeningNama = row.Account.trim();

        try {
          const cash = resolveCash(rekeningNama);

          if (subCategory === "Pembayaran Pinjaman") {
            const idemKey = `IMPORT_SEPT2026:PINJAMAN:${i}`;
            const sudah = await findEntryByKey(tx, idemKey);
            if (sudah) { stats.expenseSkip++; continue; }
            const utangPihakKetiga = await resolveAccount(tx, SYSTEM_KEYS.UTANG_PIHAK_KETIGA);
            console.log(`  [PINJAMAN] ${isoDate} ${keterangan} — Rp${nominal} (Dr Utang Pihak Ketiga / Cr ${cash.name})`);
            if (APPLY) {
              await postJournal(tx, {
                date: isoDate, description: `${IMPORT_TAG} ${keterangan}`, source: "MANUAL", idempotencyKey: idemKey, userId: admin.id,
                lines: [
                  { accountId: utangPihakKetiga.id, debit: toMoney(nominal), description: `Pelunasan — ${keterangan}` },
                  { accountId: cash.accountId, credit: toMoney(nominal), description: `Uang keluar — ${cash.name}`, cashAccountId: cash.id },
                ],
              });
            }
            stats.pinjaman++;
            continue;
          }

          if (subCategory === "Aset Tak Berwujud") {
            const idemKey = `IMPORT_SEPT2026:ASET:${i}`;
            const sudah = await findEntryByKey(tx, idemKey);
            if (sudah) { stats.expenseSkip++; continue; }
            const asetTakBerwujud = await resolveAccount(tx, SYSTEM_KEYS.ASET_TAK_BERWUJUD);
            console.log(`  [ASET] ${isoDate} ${keterangan} — Rp${nominal} (Dr Aset Tak Berwujud / Cr ${cash.name})`);
            if (APPLY) {
              await postJournal(tx, {
                date: isoDate, description: `${IMPORT_TAG} ${keterangan}`, source: "MANUAL", idempotencyKey: idemKey, userId: admin.id,
                lines: [
                  { accountId: asetTakBerwujud.id, debit: toMoney(nominal), description: keterangan },
                  { accountId: cash.accountId, credit: toMoney(nominal), description: `Uang keluar — ${cash.name}`, cashAccountId: cash.id },
                ],
              });
            }
            stats.aset++;
            continue;
          }

          // Pengeluaran biasa lewat FinExpense + postExpenseApproved.
          const kode = kategoriKode(subCategory, keterangan);
          const kategori = kategoriByCode.get(kode);

          const existing = await tx.finExpense.findFirst({
            where: { date: toBookDate(isoDate), amount: toMoney(nominal), description: keterangan },
            select: { id: true },
          });
          if (existing) { stats.expenseSkip++; continue; }

          console.log(`  [EXP] ${isoDate} ${keterangan} — Rp${nominal} (${kode}, ${cash.name})`);
          if (APPLY) {
            const expenseNumber = await generateDocumentNumber(tx, "EXP", toBookDate(isoDate));
            const bookDate = toBookDate(isoDate);
            const created = await tx.finExpense.create({
              data: {
                expenseNumber,
                date: bookDate,
                amount: toMoney(nominal),
                description: keterangan,
                categoryId: kategori.id,
                division: kategori.division,
                mode: "LANGSUNG",
                cashAccountId: cash.id,
                status: "DIBAYAR",
                submittedAt: bookDate,
                approvedAt: bookDate,
                approvedById: admin.id,
                paidAt: bookDate,
                paidById: admin.id,
                createdById: admin.id,
                notes: `${IMPORT_TAG} sub-category asal: ${subCategory || "(kosong)"}`,
              },
              select: { id: true },
            });
            await postExpenseApproved(tx, { expenseId: created.id, userId: admin.id });
          }
          stats.expense++;
        } catch (e) {
          stats.error++;
          console.error(`  ERROR baris ${i} (${keterangan}): ${e.message}`);
        }
      }
    },
    { timeout: 120_000 }
  );

  // ── KASBON ────────────────────────────────────────────────────────────
  const kasbonRows = readCsv("kasbon_september.csv");
  console.log(`\n=== Kasbon (${kasbonRows.length} baris di file) ===`);

  await prisma.$transaction(
    async (tx) => {
      for (const [i, row] of kasbonRows.entries()) {
        const karyawan = row.Karyawan.trim();
        const isoDate = ddmmyyyyToIso(row.Date);
        const nominal = idrToNumber(row.Amount);
        const rekeningNama = row.Account.trim();

        try {
          const cash = resolveCash(rekeningNama);
          const kasbonId = `IMPORT-KASBON-SEPT2026-${i}`;
          console.log(`  [KASBON] ${isoDate} ${karyawan} — Rp${nominal} (dari ${cash.name})`);
          if (APPLY) {
            const result = await postKasbonDiberikan(tx, {
              kasbonId, date: isoDate, amount: nominal, karyawanNama: karyawan, cashAccount: cash, userId: admin.id,
            });
            if (!result.created) stats.kasbonSkip++;
            else stats.kasbon++;
          } else {
            stats.kasbon++;
          }
        } catch (e) {
          stats.error++;
          console.error(`  ERROR kasbon baris ${i} (${karyawan}): ${e.message}`);
        }
      }
    },
    { timeout: 60_000 }
  );

  console.log("\n=== RINGKASAN ===");
  console.log(`Pengeluaran diimpor   : ${stats.expense} (dilewati karena sudah ada: ${stats.expenseSkip})`);
  console.log(`Pelunasan pinjaman    : ${stats.pinjaman}`);
  console.log(`Kapitalisasi aset     : ${stats.aset}`);
  console.log(`Kasbon diimpor        : ${stats.kasbon} (dilewati karena sudah ada: ${stats.kasbonSkip})`);
  console.log(`Error                 : ${stats.error}`);
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
