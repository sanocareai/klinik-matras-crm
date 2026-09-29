// EXPORT EXCEL FINANCE (B3.9) — satu endpoint untuk 11 modul.
//   POST /api/finance/export/:modul   body: { periode?:{from,to}, filter?:{}, ids?:[], filterLabel?:"" }  → berkas .xlsx
// POST (bukan GET) karena `ids` (baris yang tampil di layar) bisa panjang. Read-only: tidak ada tulis ke database.
// Izin: sama dengan endpoint daftar modul itu (registry.js). Kolom sensitif hanya untuk FINANCE_ADMIN.
// Berkas dibangun server-side (exceljs); aturan format/keamanan ada di services/finance/export/excel.js.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { MODUL_EXPORT } from "../services/finance/export/registry.js";
import { buatXlsx, namaBerkas, labelPeriode, ExportError } from "../services/finance/export/excel.js";

export const financeExportRouter = express.Router();

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAKS_ID = 20_000;

/** Tanggal kalender yang benar-benar ada ("2026-02-31" dan "2026-13-45" DITOLAK). */
export function tanggalKalenderValid(v) {
  const m = POLA_TANGGAL.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function normalisasiPeriode(p) {
  const hasil = {};
  for (const k of ["from", "to"]) {
    const v = p?.[k];
    if (v === undefined || v === null || v === "") continue;
    if (!tanggalKalenderValid(v)) throw new ExportError(`Tanggal ${k === "from" ? "awal" : "akhir"} periode tidak valid (format YYYY-MM-DD)`, 400, "PERIODE_TIDAK_VALID");
    hasil[k] = String(v);
  }
  if (hasil.from && hasil.to && hasil.from > hasil.to) throw new ExportError("Tanggal awal periode lebih besar dari tanggal akhir", 400, "PERIODE_TIDAK_VALID");
  return hasil;
}

// Pembuat xlsx bekerja di memori dan menahan event loop (proses yang sama juga melayani webhook WhatsApp & 24 akun CRM): SATU export pada satu waktu,
// maksimal 2 menunggu; selebihnya 429 supaya tiga orang yang menekan tombol bersamaan tidak menghabiskan memori server.
const MAKS_MENUNGGU = 2;
let sedangJalan = false;
const antrean = [];
function masukAntrean() {
  if (!sedangJalan) { sedangJalan = true; return Promise.resolve(); }
  if (antrean.length >= MAKS_MENUNGGU) return null;
  return new Promise((selesai) => antrean.push(selesai));
}
function keluarAntrean() {
  const berikut = antrean.shift();
  if (berikut) berikut(); else sedangJalan = false;
}

/** Nilai filter harus skalar (teks/angka/boolean); objek & array ditolak kecuali daftar id (klaimIds dst.) — input rusak = 400, bukan 500. */
function periksaNilaiFilter(filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > MAKS_ID || v.some((x) => typeof x !== "string" && typeof x !== "number")) throw new ExportError(`Filter "${k}" tidak valid`, 400, "FILTER_TIDAK_VALID");
    } else if (typeof v === "object" || (typeof v === "string" && v.length > 200)) {
      throw new ExportError(`Filter "${k}" tidak valid`, 400, "FILTER_TIDAK_VALID");
    }
  }
}

financeExportRouter.post("/export/:modul", requireAuth, async (req, res) => {
  let antre = false;
  try {
    const modul = Object.hasOwn(MODUL_EXPORT, req.params.modul) ? MODUL_EXPORT[req.params.modul] : null;
    if (!modul) return res.status(404).json({ error: "Modul export tidak dikenal" });
    if (!modul.izin.some((izin) => hasPermission(req.user, izin))) {
      return res.status(403).json({ error: `Akun Anda tidak punya izin mengekspor ${modul.nama}`, code: "TIDAK_BERHAK" });
    }
    const body = req.body || {};
    let ids = null;
    if (body.ids !== undefined && body.ids !== null) {
      if (!Array.isArray(body.ids)) throw new ExportError("Daftar baris (ids) tidak valid", 400, "IDS_TIDAK_VALID");
      if (body.ids.length > MAKS_ID) throw new ExportError(`Terlalu banyak baris terpilih (maks ${MAKS_ID.toLocaleString("id-ID")}). Persempit filter.`, 413, "TERLALU_BESAR");
      ids = [...new Set(body.ids.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 64))];
    }
    const periode = normalisasiPeriode(body.periode);
    const filter = body.filter && typeof body.filter === "object" && !Array.isArray(body.filter) ? { ...body.filter } : {};
    periksaNilaiFilter(filter);
    // Filter tanggal di dalam `filter` (mis. from/to modul yang punya tanggal sendiri) divalidasi seketat periode.
    for (const k of ["from", "to", "tanggal", "tanggalDari", "tanggalSampai"]) {
      if (filter[k] !== undefined && filter[k] !== null && filter[k] !== "" && !tanggalKalenderValid(filter[k])) {
        throw new ExportError(`Filter tanggal "${k}" tidak valid (format YYYY-MM-DD)`, 400, "FILTER_TIDAK_VALID");
      }
    }
    const filterLabel = String(body.filterLabel || "").slice(0, 400);
    const ctx = { user: req.user, periode, filter, ids, filterLabel, bolehSensitif: hasPermission(req.user, P.FINANCE_ADMIN) };

    const giliran = masukAntrean();
    if (!giliran) return res.status(429).json({ error: "Server sedang menyiapkan export lain. Coba lagi beberapa detik lagi.", code: "SIBUK" });
    antre = true;
    await giliran;

    const data = await modul.ambil(prisma, ctx);
    data.periodeLabel ||= labelPeriode(periode);
    data.filterLabel ||= filterLabel;
    // Modul yang difilter di klien memuat baris yang tampil di layar (layar sendiri membatasi jumlah baris yang dimuat): beri tahu pembaca berkas.
    if (ids && ids.length >= 200) {
      for (const sh of data.sheets || []) {
        sh.catatan = [...(sh.catatan || []), `Berkas ini memuat ${ids.length} baris yang tampil di layar. Layar membatasi jumlah baris yang dimuat; bila periode/filter mencakup lebih banyak data, persempit periode lalu ekspor lagi.`];
      }
    }
    const buf = await buatXlsx(data, { pengekspor: req.user?.name || "", bolehSensitif: ctx.bolehSensitif });

    const nama = namaBerkas(modul.nama, periode);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nama}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(buf);
  } catch (e) {
    if (e instanceof ExportError) return res.status(e.statusCode).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    // Input rusak yang lolos ke Prisma (enum/uuid tidak valid) → 400 tanpa membocorkan struktur query.
    if (e?.name === "PrismaClientValidationError" || ["P2023", "P2007", "P2009"].includes(e?.code) || /invalid input (syntax|value) for (type uuid|enum)/i.test(String(e?.message || ""))) {
      return res.status(400).json({ error: "Filter export tidak valid. Periksa filter yang dipilih lalu coba lagi.", code: "FILTER_TIDAK_VALID" });
    }
    handleFinanceError(e, res);
  } finally {
    if (antre) keluarAntrean();
  }
});
