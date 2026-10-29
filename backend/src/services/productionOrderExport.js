// EXPORT EXCEL ORDER PRODUKSI (.xlsx sungguhan, bukan CSV berekstensi .xlsx). Baris-baris berasal dari listWorkOrders({semua:true}) = daftar yang SAMA dengan layar, jadi hasil ekspor persis mengikuti filter.
// Sheet: Ringkasan Unit · Rencana Bahan · Pemakaian Aktual · Komponen Lama · Info Ekspor. Di sheet data: header baris 1 (dibekukan, AutoFilter), tanpa sel digabung, angka tetap numerik, tanggal/waktu WIB,
// warna status mengikuti nada UI (hijau/biru/oranye/abu) DAN selalu disertai teks (tidak mengandalkan warna). Teks pengguna dinetralkan dari rumus Excel (netralkanRumus).
import { BUKAN_KEKURANGAN, CATATAN_HPP, KELENGKAPAN_LABEL } from "../lib/domain/kelengkapanOrderProduksi.js";
import { terapkanKeadaanEfektif } from "./catatanPemakaianHistoris.js";
import ExcelJS from "exceljs";
import { WIB_OFFSET_MS } from "../utils/wib.js";
import { netralkanRumus } from "./finance/export/excel.js";
import { kelompokDariItemGroup, KELOMPOK_BELUM, LABEL_BELUM } from "../constants/kelompokBahan.js";
import { stokLokasi } from "./stokLokasi.js";

const FORMAT_TANGGAL = "dd/mm/yyyy"; const FORMAT_WAKTU = "dd/mm/yyyy hh:mm"; const FORMAT_ANGKA = "#,##0.####";
const WARNA = Object.freeze({ // fill, teks — nada yang sama dengan badge UI
  green: ["FFDCFCE7", "FF166534"], accent: ["FFDBEAFE", "FF1E40AF"], orange: ["FFFFEDD5", "FF9A3412"], red: ["FFFEE2E2", "FF991B1B"], neutral: ["FFF1F5F9", "FF475569"],
});
const HEADER_FILL = "FF1E2139";

const teks = (v) => (v === null || v === undefined || v === "" ? null : netralkanRumus(String(v).slice(0, 32000)));
const waktuWib = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + WIB_OFFSET_MS); };
const tanggalWib = (v) => { const w = waktuWib(v); return w ? new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate())) : null; };
const angka = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v?.toString?.() ?? v); return Number.isFinite(n) ? n : null; };
const stampWib = (d) => { const w = new Date(d.getTime() + WIB_OFFSET_MS).toISOString(); return { tanggal: w.slice(0, 10), jam: w.slice(11, 16) }; };

export function namaBerkasEkspor(sekarang = new Date()) { const s = stampWib(sekarang); return `Order-Produksi-${s.tanggal.replaceAll("-", "")}-${s.jam.replace(":", "")}.xlsx`; }

const LABEL_STATE_CATATAN = { TERCATAT_DI_STOK: "Sudah tercatat di stok", PERLU_DICEK: "Perlu dicek", SIAP_POSTING: "Siap jadi pengeluaran stok", DIPOSTING: "Sudah jadi pengeluaran stok", BUKAN_STOK: "Bukan stok Gudang", DIKOREKSI: "Sudah dikoreksi" };
function sheetData(wb, nama, kolom, baris) {
  const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = kolom.map((k) => ({ header: k.header, key: k.key, width: k.lebar || 18 }));
  const h = ws.getRow(1); h.height = 24;
  h.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }; c.alignment = { vertical: "middle", horizontal: "left", wrapText: true }; });
  for (const b of baris) {
    const r = ws.addRow({});
    kolom.forEach((k, i) => {
      const c = r.getCell(i + 1); const v = b[k.key];
      if (k.tipe === "angka") { const n = angka(v); if (n !== null) { c.value = n; c.numFmt = FORMAT_ANGKA; c.alignment = { horizontal: "right" }; } }
      else if (k.tipe === "tanggal") { const d = tanggalWib(v); if (d) { c.value = d; c.numFmt = FORMAT_TANGGAL; } }
      else if (k.tipe === "waktu") { const d = waktuWib(v); if (d) { c.value = d; c.numFmt = FORMAT_WAKTU; } }
      else { const t = teks(v); if (t !== null) { c.value = t; c.alignment = { vertical: "top", wrapText: !!k.bungkus }; } }
      if (k.nada && b[k.nada]) { const [bg, fg] = WARNA[b[k.nada]] || WARNA.neutral; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.font = { color: { argb: fg }, bold: true }; }
    });
  }
  if (kolom.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, baris.length + 1), column: kolom.length } };
  return ws;
}

/** @returns {Promise<Buffer>} */
export async function buatWorkbookOrderProduksi(prisma, { rows, unitIds, filter = {}, pengguna = null, sekarang = new Date() }) {
  const unitById = new Map(rows.map((r) => [r.id, r]));
  const ids = unitIds?.length ? unitIds : rows.map((r) => r.id);

  // ── data tambahan (batch)
  const [rencana, pergerakan, komponenRows, sementaraRows, catatanRows] = await Promise.all([
    ids.length ? prisma.productionUnitMaterialPlan.findMany({ where: { unitId: { in: ids } } }) : [],
    ids.length ? prisma.stockMovement.findMany({
      where: { unitId: { in: ids }, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, unitId: true, type: true, qty: true, note: true, reason: true, createdAt: true, material: { select: { id: true, code: true, name: true, unit: true } }, createdBy: { select: { name: true } }, materialIssue: { select: { issueNumber: true } } },
    }) : [],
    ids.length ? prisma.unitComponentReuseEntry.findMany({ where: { unitId: { in: ids } }, orderBy: [{ createdAt: "asc" }, { version: "asc" }] }) : [],
    ids.length ? prisma.unitProvisionalUsage.findMany({ where: { unitId: { in: ids } }, include: { material: { select: { code: true, name: true } } }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] }) : [],
    // Catatan pemakaian historis (Excel Admin Sales): nilai ASLI + keadaan + penanda "Perlu dicek"; terpisah dari Pemakaian Aktual (bukan transaksi stok).
    ids.length ? prisma.unitUsageNote.findMany({ where: { unitId: { in: ids }, state: { not: "TIDAK_DIHITUNG" } }, orderBy: [{ orderNumber: "asc" }, { origin: "asc" }, { sourceRow: "asc" }], include: { material: { select: { code: true, name: true, unit: true } } } }).then((rows) => terapkanKeadaanEfektif(prisma, rows)) : [],
  ]);
  const matIds = [...new Set(rencana.flatMap((p) => p.lines.map((l) => l.materialId)))];
  const bahan = matIds.length ? new Map((await prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true, code: true, name: true, unit: true, itemGroup: true } })).map((m) => [m.id, m])) : new Map();
  const katalog = rencana.length ? new Map((await stokLokasi(prisma)).rows.map((r) => [r.materialId, r])) : new Map();
  const jumlahBahanPerUnit = new Map(rencana.map((p) => [p.unitId, p.lines.length]));

  const wb = new ExcelJS.Workbook(); wb.creator = "Klinik Matras — Order Produksi"; wb.created = sekarang;

  // ── Sheet 1: Ringkasan Unit
  const ringkas = rows.map((u) => ({
    kodeOrder: u.order?.orderNumber, kodeUnit: u.unitCode, pelanggan: u.order?.customer?.name, layanan: (u.order?.items || []).map((i) => i.layananName).filter(Boolean).join("; "),
    target: u.adopsi.targetSelesai?.at, pic: u.adopsi.pic?.nama, meja: u.adopsi.meja,
    statusOrder: u.adopsi.statusOrder?.label, nadaOrder: u.adopsi.statusOrder?.key === "TERKIRIM" || u.adopsi.statusOrder?.key === "SIAP_KIRIM" ? "green" : u.status === "CANCELLED" ? "neutral" : u.adopsi.statusOrder?.key === "PENGAMBILAN" ? "neutral" : "accent",
    posisi: u.adopsi.posisi?.label, nadaPosisi: u.adopsi.posisi?.tone, posisiDetail: u.adopsi.posisi?.detail,
    kerja: u.adopsi.kerja?.label, nadaKerja: u.adopsi.kerja?.tone, sumberKerja: u.adopsi.kerja?.sourceLabel,
    jadwal: u.adopsi.jadwal ? `${u.adopsi.jadwal.tanggal}${u.adopsi.jadwal.meja ? ` · ${String(u.adopsi.jadwal.meja).replace("TABLE_", "Meja ")}` : ""} (${u.adopsi.jadwal.sumber === "V2" ? "Pelaksanaan Meja" : "Rencana Admin"})` : "Belum dijadwalkan", faktaJadwal: u.adopsi.kerja?.faktaJadwal ?? null,
    pemakaianBaru: u.adopsi.pemakaianBahan?.baruCatatan ?? 0, pemakaianLama: u.adopsi.pemakaianBahan?.komponenLamaDipakaiKembali ?? 0, pemakaianSementara: u.adopsi.pemakaianBahan?.sementaraPerluRekonsiliasi ?? 0,
    qc: ({ WAITING_QC: "Menunggu QC", REWORK: "Dikerjakan ulang (hasil QC: tidak lulus)", COMPLETED: "Tahap selesai (lihat hasil QC di Unit 360)" })[u.productionStatus] ?? "Belum ada catatan QC",
    catatanDicek: u.adopsi.catatanHistoris?.perluDicek ?? 0, catatanTotal: u.adopsi.catatanHistoris?.total ?? 0,
    kelengkapan: u.adopsi.kelengkapan?.ringkas || "Lengkap menurut aturan saat ini", kelengkapanAlasan: (Object.values(u.adopsi.kelengkapan?.items ?? {})).map((it) => `${it.label}: ${it.alasan.map((a) => a.teks).join(" ")}`).join(" | "),
    pernyataanTanpaBahan: u.adopsi.kelengkapan?.pernyataan ? `Dinyatakan tanpa bahan baru${u.adopsi.kelengkapan.pernyataan.oleh ? ` oleh ${u.adopsi.kelengkapan.pernyataan.oleh}` : ""}: ${u.adopsi.kelengkapan.pernyataan.alasan ?? ""}` : "",
    tindakan: u.adopsi.tindakan?.label, aktor: u.adopsi.tindakan?.aktor, prioritas: u.priorityDisplay?.label, bahanRencana: jumlahBahanPerUnit.get(u.id) ?? 0, aktualAda: u.adopsi.aktualBahanAda ? "Ya" : "Belum", diperbarui: u.updatedAt,
  }));
  sheetData(wb, "Ringkasan Unit", [
    { key: "kodeOrder", header: "Kode Order", lebar: 20 }, { key: "kodeUnit", header: "Kode Unit", lebar: 24 }, { key: "pelanggan", header: "Pelanggan", lebar: 28 },
    { key: "layanan", header: "Layanan (Sales)", lebar: 42, bungkus: true }, { key: "target", header: "Target Selesai", tipe: "tanggal", lebar: 15 }, { key: "pic", header: "PIC", lebar: 20 }, { key: "meja", header: "Meja", lebar: 12 },
    { key: "statusOrder", header: "Status Order", lebar: 16, nada: "nadaOrder" }, { key: "posisi", header: "Posisi Unit", lebar: 38, nada: "nadaPosisi" }, { key: "posisiDetail", header: "Dasar Posisi Unit", lebar: 44, bungkus: true },
    { key: "kerja", header: "Status Kerja (Administratif)", lebar: 22, nada: "nadaKerja" }, { key: "sumberKerja", header: "Sumber Status Kerja", lebar: 28 }, { key: "jadwal", header: "Jadwal Produksi", lebar: 34 }, { key: "faktaJadwal", header: "Fakta Jadwal", lebar: 24 },
    { key: "pemakaianBaru", header: "Pemakaian Bahan Baru (jumlah catatan)", tipe: "angka", lebar: 18 }, { key: "pemakaianLama", header: "Komponen Lama Dipakai Kembali (jumlah)", tipe: "angka", lebar: 20 }, { key: "pemakaianSementara", header: "Pemakaian Sementara — Perlu Rekonsiliasi Gudang (jumlah)", tipe: "angka", lebar: 24 }, { key: "qc", header: "Status QC (aplikasi)", lebar: 34 },
    { key: "tindakan", header: "Tindakan Berikutnya", lebar: 40, bungkus: true }, { key: "aktor", header: "Pelaku Tindakan", lebar: 16 }, { key: "prioritas", header: "Prioritas", lebar: 12 },
    { key: "catatanTotal", header: "Catatan Pemakaian Historis (jumlah)", tipe: "angka", lebar: 18 }, { key: "catatanDicek", header: "Catatan Historis Perlu Dicek (jumlah)", tipe: "angka", lebar: 18 },
    { key: "bahanRencana", header: "Jumlah Bahan Direncanakan", tipe: "angka", lebar: 16 }, { key: "aktualAda", header: "Pemakaian Aktual Tercatat", lebar: 14 },
    { key: "kelengkapan", header: "Kelengkapan (Bahan · HPP operasional · Data order)", lebar: 44, bungkus: true }, { key: "kelengkapanAlasan", header: "Alasan Kekurangan", lebar: 70, bungkus: true }, { key: "pernyataanTanpaBahan", header: "Pernyataan Tanpa Bahan Baru", lebar: 46, bungkus: true },
    { key: "diperbarui", header: "Diperbarui (WIB)", tipe: "waktu", lebar: 18 },
  ], ringkas);

  // ── Sheet 2: Rencana Bahan
  const barisRencana = [];
  for (const p of rencana) {
    const u = unitById.get(p.unitId); if (!u) continue;
    for (const l of p.lines) {
      const m = bahan.get(l.materialId); const k = katalog.get(l.materialId); const grup = kelompokDariItemGroup(m?.itemGroup);
      const ada = k && k.saldo !== null;
      barisRencana.push({ kodeUnit: u.unitCode, kodeOrder: u.order?.orderNumber, kelompok: grup.kode === KELOMPOK_BELUM ? LABEL_BELUM : grup.label, materialId: m?.code ?? l.materialId, nama: m?.name ?? "(bahan tidak ditemukan)", satuan: m?.unit, qty: l.qty,
        ketersediaan: !k ? "Belum diketahui" : !ada ? "Belum diketahui (belum ada catatan stok)" : k.tersedia > 0 ? "Tersedia" : k.tersedia === 0 ? "Habis menurut pergerakan" : "Saldo minus — perlu dihitung fisik", nadaKet: !ada ? "neutral" : k.tersedia > 0 ? "green" : "orange", tersedia: ada ? k.tersedia : null, revisi: p.revision });
    }
  }
  sheetData(wb, "Rencana Bahan", [
    { key: "kodeUnit", header: "Kode Unit", lebar: 24 }, { key: "kodeOrder", header: "Kode Order", lebar: 20 }, { key: "kelompok", header: "Kelompok", lebar: 20 }, { key: "materialId", header: "Material ID", lebar: 22 },
    { key: "nama", header: "Nama Bahan", lebar: 34 }, { key: "satuan", header: "Satuan", lebar: 10 }, { key: "qty", header: "Jumlah Rencana", tipe: "angka", lebar: 16 },
    { key: "ketersediaan", header: "Status Ketersediaan", lebar: 34, nada: "nadaKet" }, { key: "tersedia", header: "Tersedia (angka)", tipe: "angka", lebar: 16 }, { key: "revisi", header: "Revisi Rencana", tipe: "angka", lebar: 12 },
  ], barisRencana);

  // ── Sheet 3: Pemakaian Aktual (kosong bila belum ada transaksi)
  const barisAktual = pergerakan.filter((m) => unitById.has(m.unitId)).map((m) => {
    const u = unitById.get(m.unitId);
    const dok = m.materialIssue ? { jenis: "Material Issue Gudang", nomor: m.materialIssue.issueNumber } : { jenis: m.type === "WASTE" ? "Catatan sisa/rusak" : "Catat langsung (Produksi)", nomor: `MV-${m.id.slice(0, 8).toUpperCase()}` };
    return { kodeUnit: u.unitCode, kodeOrder: u.order?.orderNumber, sumber: "Bahan baru dari Gudang", dampakStok: Number(m.qty) < 0 ? "Mengurangi stok" : "Menambah stok (koreksi/pengembalian)", kode: m.material.code, nama: m.material.name, qty: -Number(m.qty), satuan: m.material.unit, tanggal: m.createdAt, pic: m.createdBy?.name, jenisDok: dok.jenis, nomorDok: dok.nomor, catatan: m.note ?? m.reason ?? null };
  });
  sheetData(wb, "Pemakaian Aktual", [
    { key: "kodeUnit", header: "Kode Unit", lebar: 24 }, { key: "kodeOrder", header: "Kode Order", lebar: 20 }, { key: "sumber", header: "Sumber", lebar: 24 }, { key: "dampakStok", header: "Dampak Stok", lebar: 30 }, { key: "kode", header: "Material ID", lebar: 22 }, { key: "nama", header: "Nama Bahan", lebar: 34 },
    { key: "qty", header: "Jumlah Aktual", tipe: "angka", lebar: 14 }, { key: "satuan", header: "Satuan", lebar: 10 }, { key: "tanggal", header: "Tanggal (WIB)", tipe: "waktu", lebar: 18 }, { key: "pic", header: "PIC", lebar: 20 },
    { key: "jenisDok", header: "Jenis Dokumen", lebar: 28 }, { key: "nomorDok", header: "Nomor Dokumen", lebar: 24 }, { key: "catatan", header: "Catatan", lebar: 36, bungkus: true },
  ], barisAktual);

  // ── Sheet: Komponen Lama (dari kasur pelanggan; BUKAN stok): versi terkini per komponen, dipisah dari Pemakaian Aktual
  const OUT = { REUSED: "Dipakai kembali pada unit ini", RETURNED_TO_CUSTOMER: "Dikembalikan ke pelanggan", KEPT_WITH_UNIT: "Disimpan bersama unit", DISCARDED: "Dibuang" };
  const KIND = { CREATED: "Dicatat", CORRECTED: "Dikoreksi", VOIDED: "Dibatalkan (salah input)" };
  const akhirKomp = new Map(); for (const k of komponenRows) akhirKomp.set(k.itemId, k);
  const aktorKomp = new Map((komponenRows.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(komponenRows.map((k) => k.actorId))] } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const barisKomponen = [...akhirKomp.values()].filter((k) => unitById.has(k.unitId)).sort((x, y) => x.createdAt - y.createdAt).map((k) => {
    const u = unitById.get(k.unitId);
    return { kodeUnit: u.unitCode, kodeOrder: u.order?.orderNumber, asal: `Dari kasur pelanggan — ${u.unitCode}`, sumber: "Komponen lama dari unit ini", dampakStok: "Tidak ada (milik pelanggan; bukan stok, bukan biaya bahan baru)", nama: k.name, qty: Number(k.qty), satuan: k.uom, kondisi: k.condition, bagian: k.workPart, hasil: OUT[k.outcome] ?? k.outcome, pemakaian: k.kind === "VOIDED" ? "Dibatalkan" : k.outcome === "REUSED" ? "Pemakaian kembali" : "Bukan pemakaian", status: KIND[k.kind] ?? k.kind, versi: k.version, pic: aktorKomp.get(k.actorId), tanggal: k.createdAt, alasan: k.reason, catatan: k.note, foto: (k.photoUrls || []).length };
  });
  sheetData(wb, "Komponen Lama", [
    { key: "kodeUnit", header: "Kode Unit", lebar: 24 }, { key: "kodeOrder", header: "Kode Order", lebar: 20 }, { key: "asal", header: "Asal", lebar: 34 }, { key: "sumber", header: "Sumber", lebar: 28 }, { key: "dampakStok", header: "Dampak Stok", lebar: 44, bungkus: true },
    { key: "nama", header: "Nama Komponen", lebar: 30 }, { key: "qty", header: "Jumlah", tipe: "angka", lebar: 12 }, { key: "satuan", header: "Satuan", lebar: 10 }, { key: "kondisi", header: "Kondisi", lebar: 24 }, { key: "bagian", header: "Bagian Pekerjaan", lebar: 24 },
    { key: "hasil", header: "Hasil", lebar: 30 }, { key: "pemakaian", header: "Pemakaian?", lebar: 18 }, { key: "status", header: "Status Catatan", lebar: 22 }, { key: "versi", header: "Versi", tipe: "angka", lebar: 8 },
    { key: "pic", header: "PIC", lebar: 20 }, { key: "tanggal", header: "Tanggal (WIB)", tipe: "waktu", lebar: 18 }, { key: "alasan", header: "Alasan Koreksi", lebar: 30, bungkus: true }, { key: "catatan", header: "Catatan", lebar: 30, bungkus: true }, { key: "foto", header: "Jumlah Foto", tipe: "angka", lebar: 12 },
  ], barisKomponen);

  // ── Sheet: Pemakaian Sementara (bahan belum di katalog; BUKAN Material Issue; TIDAK mengurangi saldo): dipisah dari Pemakaian Aktual
  const namaSem = new Map((sementaraRows.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(sementaraRows.flatMap((r) => [r.recordedById, r.resolvedById, r.cancelledById].filter(Boolean)))] } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const STATUS_SEM = { PERLU_REKONSILIASI: "Perlu rekonsiliasi Gudang", DIREKONSILIASI: "Sudah direkonsiliasi", DIBATALKAN: "Dibatalkan (salah input)" };
  const RESOLUSI_SEM = { TAUTKAN_ISSUE: "Ditautkan ke pengeluaran stok resmi", TANPA_STOK: "Dinyatakan bukan stok Gudang" };
  const barisSementara = sementaraRows.filter((r) => unitById.has(r.unitId)).map((r) => {
    const u = unitById.get(r.unitId);
    const tertaut = !!r.materialId && !r.proposalId && (!r.stockMovementId || String(r.note ?? "").startsWith("Stok bahan belum diketahui (bahan katalog "));
    return { kodeUnit: u.unitCode, kodeOrder: u.order?.orderNumber, sumber: "Pemakaian sementara (bukan Material Issue)", jenis: tertaut ? "Bahan katalog — stok belum diketahui" : "Bahan belum ada di katalog", kodeBahan: tertaut ? r.material?.code ?? null : null, dampakStok: "Tidak ada saldo/biaya/jurnal sampai Gudang menyelesaikan sumber stok", nama: r.name, qty: Number(r.qty), satuan: r.uom, asal: r.originNote, tanggalPakai: r.usedAt, pic: namaSem.get(r.recordedById), status: r.status === "DIBATALKAN" && String(r.cancelReason ?? "").startsWith("Dikoreksi:") ? "Dikoreksi (diganti catatan baru)" : (STATUS_SEM[r.status] ?? r.status), penyelesaian: r.resolution ? RESOLUSI_SEM[r.resolution] : null, diselesaikanOleh: r.resolvedById ? namaSem.get(r.resolvedById) : null, diselesaikanAt: r.resolvedAt, catatan: r.resolutionNote ?? r.note, alasanBatal: r.cancelReason };
  });
  sheetData(wb, "Pemakaian Sementara", [
    { key: "kodeUnit", header: "Kode Unit", lebar: 24 }, { key: "kodeOrder", header: "Kode Order", lebar: 20 }, { key: "sumber", header: "Sumber", lebar: 34 }, { key: "dampakStok", header: "Dampak Stok", lebar: 44, bungkus: true },
    { key: "jenis", header: "Jenis", lebar: 32 }, { key: "kodeBahan", header: "Kode Bahan Katalog", lebar: 26 }, { key: "nama", header: "Nama Bahan", lebar: 30 }, { key: "qty", header: "Jumlah", tipe: "angka", lebar: 12 }, { key: "satuan", header: "Satuan", lebar: 10 }, { key: "asal", header: "Asal Barang", lebar: 28, bungkus: true }, { key: "tanggalPakai", header: "Waktu Dipakai (WIB)", tipe: "waktu", lebar: 18 },
    { key: "pic", header: "Dicatat Oleh", lebar: 20 }, { key: "status", header: "Status", lebar: 24 }, { key: "penyelesaian", header: "Cara Penyelesaian", lebar: 32 }, { key: "diselesaikanOleh", header: "Diselesaikan Oleh", lebar: 20 }, { key: "diselesaikanAt", header: "Diselesaikan (WIB)", tipe: "waktu", lebar: 18 },
    { key: "catatan", header: "Catatan", lebar: 30, bungkus: true }, { key: "alasanBatal", header: "Alasan Pembatalan", lebar: 26, bungkus: true },
  ], barisSementara);

  // ── Sheet: Catatan Historis (Excel Admin Sales) — nilai asli apa adanya; BUKAN transaksi stok; "Perlu dicek" = ada yang janggal + apa yang perlu dilakukan.
  const barisCatatan = catatanRows.filter((r) => unitById.has(r.unitId)).map((r) => {
    const u = unitById.get(r.unitId); const f = (r.flags ?? []).find((x) => x.tingkat === "BLOK");
    return { kodeUnit: u.unitCode, kodeOrder: r.orderNumber, sumber: r.origin === "EXCEL" ? "Excel Admin Sales" : "Pengeluaran stok lama (tanpa pasangan Excel)", nama: r.rawName ?? r.material?.name ?? null, spek: r.rawSpec || null, kategori: r.rawCategory || null,
      qtyAsli: r.rawQty ?? null, satuanAsli: r.rawUom ?? null, qty: r.qty === null ? null : Number(r.qty), satuan: r.uom ?? null, tanggal: r.usedAt, kodeBahan: r.material?.code ?? null, status: LABEL_STATE_CATATAN[r.state] ?? r.state, dicek: r.state === "PERLU_DICEK" ? "Ya" : "",
      catatan: f ? `${f.teks} ${f.aksi}` : null, refMv: r.stockMovementId ? `MV-${r.stockMovementId.slice(0, 8).toUpperCase()}` : null, barisSumber: r.sourceRow ?? null };
  });
  sheetData(wb, "Catatan Historis", [
    { key: "kodeUnit", header: "Kode Unit", lebar: 24 }, { key: "kodeOrder", header: "Kode Order", lebar: 20 }, { key: "sumber", header: "Sumber", lebar: 30 }, { key: "nama", header: "Nama Bahan (nilai asli)", lebar: 34 }, { key: "spek", header: "Spesifikasi", lebar: 24 }, { key: "kategori", header: "Kategori", lebar: 16 },
    { key: "qtyAsli", header: "Jumlah Asli (teks)", lebar: 12 }, { key: "satuanAsli", header: "Satuan Asli", lebar: 10 }, { key: "qty", header: "Jumlah Terbaca", tipe: "angka", lebar: 12 }, { key: "satuan", header: "Satuan Gudang", lebar: 10 }, { key: "tanggal", header: "Tanggal (WIB)", tipe: "waktu", lebar: 18 },
    { key: "kodeBahan", header: "Kode Bahan Katalog", lebar: 28 }, { key: "status", header: "Keadaan", lebar: 28 }, { key: "dicek", header: "Perlu Dicek", lebar: 10 }, { key: "catatan", header: "Catatan Singkat (apa yang janggal & tindakan)", lebar: 60, bungkus: true },
    { key: "refMv", header: "Tertaut ke Pergerakan Stok", lebar: 20 }, { key: "barisSumber", header: "Baris Sumber", tipe: "angka", lebar: 10 },
  ], barisCatatan);

  // ── Sheet 4: Info Ekspor (waktu ekspor + filter + arti kolom); tanpa sel digabung
  const s = stampWib(sekarang);
  const f = filter || {};
  const info = [
    ["Judul", "Order Produksi — ekspor Excel"], ["Diekspor (WIB)", `${s.tanggal} ${s.jam} WIB`], ["Diekspor oleh", pengguna || "—"], ["Zona waktu", "WIB (UTC+7)"],
    ["Filter: pencarian", f.q || "Tanpa pencarian"], ["Filter: status order", (f.displayStatus || []).join(", ") || "Semua"], ["Filter: posisi/milestone", (f.globalStatus || []).join(", ") || "Semua"],
    ["Filter: status kerja", (f.statusKerja || []).join(", ") || "Semua"], ["Filter: kelengkapan", (f.kelengkapan || []).map((k) => KELENGKAPAN_LABEL[k] ?? k).join(" ATAU ") || "Semua"], ["Filter: periode", f.periode?.dari || f.periode?.sampai ? `${f.periode.dari || "…"} s.d. ${f.periode.sampai || "…"} (dasar: ${f.dasarPeriode || "tanggal order masuk (unit dibuat)"})` : "Semua tanggal"], ["Urutan", f.urut === "terlama" ? "Paling lama belum ditangani (tanggal order masuk terlama dulu)" : "Terbaru dulu"], ["Filter: lingkup", f.scope || "Sesuai tab yang dipilih"],
    ["Jumlah unit (Ringkasan Unit)", rows.length], ["Jumlah baris Rencana Bahan", barisRencana.length], ["Jumlah baris Pemakaian Aktual", barisAktual.length], ["Jumlah baris Komponen Lama", barisKomponen.length], ["Jumlah baris Pemakaian Sementara", barisSementara.length],
    ["Arti Status Order", "Status yang dilihat Sales/Delivery (Pengambilan · Diproses · Siap Kirim · Terkirim · Dibatalkan)."],
    ["Arti Posisi Unit", "Fakta fisik dari dokumen penjemputan, penerimaan workshop, dan pengiriman."],
    ["Arti Status Kerja", "Status pekerjaan Produksi: dari aplikasi bila ada bukti, jika tidak catatan manual Admin, jika tidak mengikuti jadwal."],
    ["Status kerja administratif", "Status Kerja (Administratif) = status pekerjaan menurut Produksi/Admin. \"Sudah dikerjakan\" otomatis muncul begitu ada pemakaian aktual yang berhasil tercatat (bahan baru dari Gudang atau komponen lama dipakai kembali), tanpa wajib jadwal/rencana/Run/Meja/dokumentasi/QC. Itu BUKAN selesai QC, siap serah Gudang, atau siap kirim — kolom Jadwal Produksi, Pemakaian Bahan, dan Status QC dipisah. Rencana bahan dan komponen yang dikembalikan/disimpan/dibuang tidak mengubah status kerja."],
    ["Dua sumber pemakaian", "Sheet Pemakaian Aktual = bahan baru dari Gudang (transaksi stok resmi, mengurangi stok). Sheet Komponen Lama = komponen bongkaran milik pelanggan yang dipakai kembali/dilepas: TIDAK memengaruhi stok, jurnal, atau biaya bahan baru. Total keduanya tidak dijumlahkan."],
    ["Catatan historis", "Sheet Catatan Historis = catatan pemakaian bahan dari Excel Admin Sales, tampil apa adanya (jumlah/satuan asli). BUKAN transaksi stok: tidak mengurangi saldo, tidak ada biaya/jurnal. Yang sudah sama dengan pengeluaran stok ditautkan (tidak digandakan); yang janggal diberi label Perlu Dicek + catatan singkat."],
    ["Pemakaian sementara", "Sheet Pemakaian Sementara = fakta bahan yang sudah dipakai tetapi belum punya sumber stok resmi (bahan belum di katalog). BUKAN Material Issue: tidak mengurangi saldo, tidak ada biaya bahan, tidak ada jurnal. Tetap dihitung sebagai bukti \"Sudah dikerjakan\" dengan sumber \"Pemakaian sementara — perlu rekonsiliasi Gudang\" sampai Gudang menautkannya ke pengeluaran stok resmi atau menyatakannya bukan stok Gudang. Tidak dijumlahkan dengan Pemakaian Aktual."],
    ["Rencana vs Aktual", "Rencana Bahan TIDAK mengurangi stok. Pemakaian Aktual berisi transaksi stok resmi (Material Issue Gudang atau catat langsung)."],
    ["Kelengkapan", "Kolom Kelengkapan memakai klasifikasi yang SAMA dengan daftar dan drawer: Bahan belum dicatat (unit sudah dikerjakan/selesai tanpa catatan pemakaian dan tanpa pernyataan tanpa bahan baru) · Bahan perlu dicek (alasan konkret) · HPP belum lengkap (HPP OPERASIONAL; bukan biaya Finance) · Data order kurang (kelengkapan order Penjualan Karyawan). " + BUKAN_KEKURANGAN],
    ["HPP operasional", CATATAN_HPP],
  ];
  const wi = wb.addWorksheet("Info Ekspor"); wi.columns = [{ header: "Keterangan", key: "k", width: 34 }, { header: "Nilai", key: "v", width: 90 }];
  wi.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }; });
  for (const [k, v] of info) { const r = wi.addRow({}); r.getCell(1).value = teks(k); r.getCell(1).font = { bold: true }; const c = r.getCell(2); if (typeof v === "number") c.value = v; else c.value = teks(v); c.alignment = { wrapText: true, vertical: "top" }; }
  wi.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
