// IMPOR SEKALI-JALAN — riwayat Kasbon dari Notion ke modul Kasbon (FinKasbon).
//
// Keputusan owner (19 Sep 2026):
//  • Kasbon SEBELUM September 2026 dianggap SUDAH LUNAS (dipotong dari gaji
//    saat itu) → dibuat sebagai FinKasbon status LUNAS, historis=true, TANPA
//    jurnal. Kas bank-nya sudah dinetralkan penyesuaian saldo 18 Sep 2026
//    (SALDO_AWAL vs Laba Ditahan); memposting ulang akan menggandakan.
//  • Kasbon SEPTEMBER 2026 sudah punya jurnal (Dr Piutang Karyawan / Cr Kas)
//    dari importNotionSeptember2026.js dengan kunci IMPORT-KASBON-SEPT2026-<n>.
//    Di sini kasbon itu HANYA DITAUTKAN ke jurnal yang sudah ada (journalRef =
//    kunci lama) dan tetap AKTIF — tidak ada jurnal baru.
//  • Nama Juri/Kemal/Gilang diperlakukan sebagai kasbon biasa.
//
// Baris yang dilewati (dilaporkan): tanpa nominal/tanggal (kosong).
// Baris berformat rentang tanggal ("20/08/2026 → 01/09/2026") memakai TANGGAL
// AWAL rentang. Baris bulan September yang tidak menemukan jurnal pasangannya
// juga dilewati & dilaporkan — tidak ditebak.
//
// Idempoten: tiap FinKasbon punya journalRef unik (kunci jurnal lama, atau
// NOTION-KASBON-2026-<n> untuk yang historis); yang sudah ada dilewati.
//
//   node backend/scripts/importNotionKasbon2026.js          # pratinjau
//   node backend/scripts/importNotionKasbon2026.js --apply  # eksekusi

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";
import { generateDocumentNumber, toBookDate } from "../src/services/finance/journal.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { rapikanNama } from "../src/routes/financeKasbon.js";

const APPLY = process.argv.includes("--apply");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data/notion-data-2026");
const BERKAS = fs.readdirSync(DATA_DIR).find((f) => f.startsWith("Kasbon") && f.endsWith(".csv"));

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

const rupiah = (s) => Number(String(s || "").replace(/[^\d]/g, "") || 0);
function tanggalAwal(s) {
  const m = String(s || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (pratinjau saja)"}`);
  console.log(`Berkas: ${BERKAS}\n`);
  const baris = parseCsv(fs.readFileSync(path.join(DATA_DIR, BERKAS), "utf8").replace(/^﻿/, ""));

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi impor ini.");

  const rekeningRows = await prisma.finCashAccount.findMany({ select: { id: true, name: true } });
  const rekeningByName = new Map(rekeningRows.map((c) => [c.name.trim().toUpperCase(), c]));
  const ALIAS = { SANOBANK: "KEM - SANO BANK" };
  const cariRekening = (teks) => {
    const nama = String(teks || "").split(" (")[0].trim().toUpperCase();
    if (!nama) return null;
    return rekeningByName.get(nama) || rekeningByName.get(ALIAS[nama]) || null;
  };

  // Jurnal kasbon September yang sudah ada (dari impor lama).
  const jurnal = await prisma.finJournalLine.findMany({
    where: { account: { code: "1-1350" }, debit: { gt: 0 }, entry: { source: "KASBON", sourceId: { startsWith: "IMPORT-KASBON-SEPT2026-" }, status: { in: ["POSTED", "REVERSED"] } } },
    select: { debit: true, entry: { select: { sourceId: true, date: true, description: true } } },
  });
  const bebasJurnal = jurnal.map((j) => ({
    ref: j.entry.sourceId,
    tanggal: j.entry.date.toISOString().slice(0, 10),
    nama: j.entry.description.replace(/^Kasbon —\s*/, "").trim().toLowerCase(),
    nominal: Number(j.debit),
    dipakai: false,
  }));
  console.log(`Jurnal kasbon September yang sudah ada: ${bebasJurnal.length}`);

  const sudahAda = new Set((await prisma.finKasbon.findMany({ where: { journalRef: { not: null } }, select: { journalRef: true } })).map((k) => k.journalRef));

  const stat = { historis: 0, september: 0, dilewatiKosong: 0, dilewatiSudahAda: 0, septTanpaJurnal: 0 };
  const laporan = [];
  const rencana = [];

  baris.forEach((r, idx) => {
    const iso = tanggalAwal(r.Date);
    const nominal = rupiah(r.Amount);
    if (!iso || nominal <= 0) { stat.dilewatiKosong++; laporan.push(`  [LEWATI kosong] baris ${idx + 2}: tanggal="${r.Date}" nominal="${r.Amount}" karyawan="${r.Karyawan}"`); return; }
    const nama = rapikanNama(r.Karyawan) || "Tidak Dicatat";
    const rekening = cariRekening(r.Accounts || r.Account);

    if (iso >= "2026-09-01") {
      const cocok = bebasJurnal.find((j) => !j.dipakai && j.tanggal === iso && j.nominal === nominal && j.nama === String(r.Karyawan || "").trim().toLowerCase());
      if (!cocok) { stat.septTanpaJurnal++; laporan.push(`  [LEWATI september tanpa jurnal] ${iso} ${nama} Rp${nominal}`); return; }
      cocok.dipakai = true;
      if (sudahAda.has(cocok.ref)) { stat.dilewatiSudahAda++; return; }
      rencana.push({ jenis: "SEPTEMBER", iso, nominal, nama, rekening, ref: cocok.ref });
    } else {
      const ref = `NOTION-KASBON-2026-${idx + 2}`;
      if (sudahAda.has(ref)) { stat.dilewatiSudahAda++; return; }
      rencana.push({ jenis: "HISTORIS", iso, nominal, nama, rekening, ref });
    }
  });

  for (const p of rencana) p.jenis === "SEPTEMBER" ? stat.september++ : stat.historis++;
  const totalHistoris = rencana.filter((p) => p.jenis === "HISTORIS").reduce((a, p) => a + p.nominal, 0);
  const totalSept = rencana.filter((p) => p.jenis === "SEPTEMBER").reduce((a, p) => a + p.nominal, 0);

  console.log(`\nRencana:`);
  console.log(`  Historis (LUNAS, tanpa jurnal): ${stat.historis} baris, Rp${totalHistoris.toLocaleString("id-ID")}`);
  console.log(`  September (AKTIF, ditautkan ke jurnal lama): ${stat.september} baris, Rp${totalSept.toLocaleString("id-ID")}`);
  console.log(`  Dilewati (kosong): ${stat.dilewatiKosong} · sudah ada: ${stat.dilewatiSudahAda} · september tanpa jurnal: ${stat.septTanpaJurnal}`);
  if (laporan.length) console.log(`\nCatatan:\n${laporan.join("\n")}`);
  const belumTertaut = bebasJurnal.filter((j) => !j.dipakai && !sudahAda.has(j.ref));
  if (belumTertaut.length) console.log(`\n⚠ Jurnal September yang TIDAK menemukan pasangan di CSV: ${belumTertaut.map((j) => `${j.ref} ${j.nama} ${j.nominal}`).join("; ")}`);

  if (!APPLY) { console.log("\n(Dry-run — tidak ada yang ditulis. Jalankan ulang dengan --apply.)"); return; }

  let dibuat = 0;
  for (const p of rencana) {
    await prisma.$transaction(async (tx) => {
      const tanggal = toBookDate(p.iso);
      const historis = p.jenis === "HISTORIS";
      const k = await tx.finKasbon.create({
        data: {
          kasbonNumber: await generateDocumentNumber(tx, "KSB", tanggal),
          date: tanggal, amount: p.nominal, employeeName: p.nama,
          urgency: null,
          notes: historis ? "Impor histori Notion — dianggap sudah lunas (dipotong dari gaji)" : "Impor Notion September 2026",
          cashAccountId: p.rekening?.id || null,
          status: historis ? "LUNAS" : "AKTIF",
          historis, journalRef: p.ref, createdById: admin.id,
        },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_KASBON, entityId: k.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: admin.id,
        metadata: { kasbonNumber: k.kasbonNumber, aksi: "impor_notion", jenis: p.jenis, amount: String(p.nominal), employeeName: p.nama },
      });
    });
    dibuat++;
  }
  console.log(`\nSelesai: ${dibuat} kasbon dibuat.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
