// LAPORAN PRODUKSI TERPADU — pemuatan data (BULK, BACA-SAJA) untuk 4 tab: Ringkasan · Biaya per Order · Kinerja Produksi · Bahan & Gudang.
// Aturan murni ada di lib/domain/laporanProduksi.js. TIDAK ada tulis ke database di sini.
//
// CAKUPAN (beda dari laporan KPI lama, yang hanya membaca unit dalam kohort pembaca V2): semua unit non-batal — dikerjakan langsung (Order Produksi), historis, atau di luar rencana V2.
// Satu pemuatan konteks dipakai bersama oleh semua tab → angka Ringkasan = Biaya per Order = Excel (tidak ada hitungan kedua yang bisa menyimpang).
//
// HINDARI HITUNG GANDA ANTAR SUMBER: biaya HANYA dari pergerakan stok unit (ISSUE/RETURN/WASTE/ADJUSTMENT) dengan harga beku (stock_movement_biaya_operasional). Catatan pemakaian historis
// yang sudah TERCATAT_DI_STOK/DIPOSTING hanya metadata tanggal pemakaian dari pergerakan yang sama (tidak dijumlahkan lagi); catatan PERLU_DICEK/SIAP_POSTING dihitung sebagai MASALAH, bukan biaya.
import { parsePeriod } from "../lib/domain/productionMetrics.js";
import { BOARD_DEFAULTS, stationLabel } from "../lib/domain/productionBoard.js";
import { TIPE_OP } from "./finance/hargaBerlaku.js";
import { UNIT_INCLUDE, perkayaBarisUnit, hitungKelengkapanDaftar } from "./productionOrderList.js";
import { muatFaktaKelengkapan } from "./productionKelengkapan.js";
import { loadWorkshopTimelines } from "./workshopTimelineService.js";
import {
  agregasi, barisPergerakan, gabungAgregasi, hariDalamPeriode, isGuard, kelompokkanSelesai, rataDurasi, seriHarian, statusBiaya, wibKeyDari,
} from "../lib/domain/laporanProduksi.js";

export const DASAR_TANGGAL = Object.freeze({
  biaya: "Tanggal PEMAKAIAN bahan (tanggal yang dilaporkan bila ada pembetulan; tanggal pemakaian catatan historis; selain itu hari pencatatan) — hari kalender WIB",
  selesai: "Waktu produksi menyerahkan barang jadi ke Gudang (serah terima barang jadi) — hari kalender WIB",
  jadwal: "Tanggal produksi pada jadwal/rencana (papan Meja) — hari kalender WIB",
  permintaan: "Waktu permintaan bahan dibuat / diterbitkan — hari kalender WIB",
  posisi: "Posisi SAAT INI (bukan aktivitas dalam periode)",
});

/** Stempel waktu pada timeline (timelineOf → { timestamps: [{ key, at }] }). */
const stempel = (t, key) => t?.timestamps?.find((x) => x.key === key)?.at ?? null;
const kunciPeriode = (q) => { const p = parsePeriod({ from: q.from, to: q.to }); return { ...p, hari: hariDalamPeriode(p.from, p.to) }; };
export const periodeLaporan = kunciPeriode;
const dalam = (key, p) => !!key && key >= p.from && key <= p.to;

/** Muat SEMUA pergerakan unit bertipe biaya + baris biaya beku terakhir; hitung tanggal pemakaian. Dibatasi oleh indeks unit_id; satu query + satu query catatan tertaut. */
async function muatPergerakan(prisma) {
  const mv = await prisma.stockMovement.findMany({
    where: { unitId: { not: null }, type: { in: TIPE_OP } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, type: true, qty: true, createdAt: true, note: true, materialId: true, unitId: true, correctsMovementId: true,
      material: { select: { code: true, name: true, unit: true } },
      biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true, unitCost: true, value: true, priceEffectiveFrom: true, basisHarga: true, sumber: true, evidenceLabel: true } },
    },
  });
  const ids = mv.map((m) => m.id);
  const catatan = ids.length ? await prisma.unitUsageNote.findMany({ where: { stockMovementId: { in: ids }, state: { in: ["DIPOSTING", "TERCATAT_DI_STOK"] }, usedAt: { not: null } }, select: { stockMovementId: true, usedAt: true } }) : [];
  const usedAt = new Map(); for (const c of catatan) if (!usedAt.has(c.stockMovementId)) usedAt.set(c.stockMovementId, c.usedAt);
  return mv.map((m) => barisPergerakan(
    { id: m.id, type: m.type, qty: m.qty, createdAt: m.createdAt, note: m.note, materialId: m.materialId, unitId: m.unitId, correctsMovementId: m.correctsMovementId, materialKode: m.material.code, materialNama: m.material.name, materialSatuan: m.material.unit },
    m.biayaOperasional[0] ? { ...m.biayaOperasional[0], unitCost: m.biayaOperasional[0].unitCost, value: m.biayaOperasional[0].value } : null,
    { usedAtCatatan: usedAt.get(m.id) ?? null },
  ));
}

/**
 * Konteks bersama (satu kali per permintaan): pergerakan, unit non-batal + order, linimasa serah barang jadi, jadwal/PIC.
 * `opsi.termasukBelumAdaPemakaian`: sertakan order yang unitnya MASUK (dibuat) pada periode walau belum ada aktivitas bahan.
 */
export async function bangunKonteks(prisma, query = {}) {
  const periode = kunciPeriode(query);
  const termasukMasuk = String(query.termasukMasuk ?? "") === "1";
  const semuaMov = await muatPergerakan(prisma);
  const units = await prisma.unit.findMany({ where: { status: { not: "CANCELLED" } }, select: { id: true, unitCode: true, status: true, orderId: true, seq: true, createdAt: true, order: { select: { id: true, orderNumber: true, status: true, customer: { select: { name: true } } } } } });
  const unitById = new Map(units.map((u) => [u.id, u]));
  const timelines = await loadWorkshopTimelines(prisma, units.map((u) => u.id));
  const selesaiTs = new Map(); // unitId → { at, key } waktu serah barang jadi (TIDAK ada → tidak dihitung selesai pada periode mana pun)
  for (const [unitId, t] of timelines) { const at = stempel(t, "productionFinishedAt"); if (at) selesaiTs.set(unitId, { at, key: wibKeyDari(at) }); }
  const movPeriode = semuaMov.filter((b) => unitById.has(b.unitId) && dalam(b.tanggalPemakaian, periode));
  const movKeluarUnit = semuaMov.filter((b) => !unitById.has(b.unitId)).length; // pergerakan pada unit batal/tidak ada (dilaporkan sebagai cakupan, tidak dihitung)
  return { periode, termasukMasuk, units, unitById, timelines, selesaiTs, semuaMov, movPeriode, movKeluarUnit };
}

// ───────────────────────────────────────────── BIAYA PER ORDER ─────────────────────────────────────────────
const MASALAH_URUT = ["BELUM_DIBEKUKAN", "TANPA_HARGA", "GAGAL", "CATATAN_TERTAHAN", "BAHAN_BELUM_DICATAT", "SEMENTARA", "GUARD"];

async function masalahPerUnit(prisma, unitIds) {
  const out = new Map(); if (!unitIds.length) return { masalah: out, baris: new Map() };
  const units = await prisma.unit.findMany({ where: { id: { in: unitIds } }, include: UNIT_INCLUDE });
  const [fakta, baris] = await Promise.all([muatFaktaKelengkapan(prisma, unitIds), perkayaBarisUnit(prisma, units)]);
  const peta = new Map(baris.map((b) => [b.id, b]));
  for (const id of unitIds) {
    const f = fakta.get(id); const b = peta.get(id); const keys = b?.adopsi?.kelengkapan?.keys ?? [];
    out.set(id, {
      catatanTertahan: (f?.catatan.perluDicek ?? 0) + (f?.catatan.siapPosting ?? 0),
      bahanBelumDicatat: keys.includes("BAHAN_BELUM_DICATAT") ? 1 : 0,
      sementara: (f?.sementara.perluTerpetakan ?? 0) + (f?.sementara.perluBelumTerpetakan ?? 0),
      dinilai: b?.adopsi?.kelengkapan?.bahanDinilai === true,
      pernyataan: !!f?.pernyataan,
      kelengkapan: keys,
    });
  }
  return { masalah: out, baris: peta };
}

/** Daftar order relevan + agregasi (SEMUA hasil; paginasi dilakukan pemanggil). */
export async function biayaPerOrder(prisma, ctx, { izinHarga = false } = {}) {
  const { periode, units, unitById, movPeriode, selesaiTs, termasukMasuk } = ctx;
  const orderRelevan = new Set();
  for (const b of movPeriode) orderRelevan.add(unitById.get(b.unitId).orderId);
  for (const [unitId, s] of selesaiTs) if (dalam(s.key, periode) && unitById.has(unitId)) orderRelevan.add(unitById.get(unitId).orderId);
  if (termasukMasuk) for (const u of units) if (dalam(wibKeyDari(u.createdAt), periode)) orderRelevan.add(u.orderId);
  const unitDiOrder = new Map(); for (const u of units) { if (!orderRelevan.has(u.orderId)) continue; if (!unitDiOrder.has(u.orderId)) unitDiOrder.set(u.orderId, []); unitDiOrder.get(u.orderId).push(u); }
  const unitIds = [...unitDiOrder.values()].flat().map((u) => u.id);
  const { masalah, baris: barisUnit } = await masalahPerUnit(prisma, unitIds);
  const movPerUnit = new Map(); for (const b of movPeriode) { if (!movPerUnit.has(b.unitId)) movPerUnit.set(b.unitId, []); movPerUnit.get(b.unitId).push(b); }

  const orders = [];
  for (const [orderId, us] of unitDiOrder) {
    us.sort((a, b) => a.seq - b.seq);
    const unitAgg = us.map((u) => {
      const m = movPerUnit.get(u.id) ?? []; const mu = masalah.get(u.id) ?? {};
      // BAHAN_BELUM_DICATAT hanya berlaku bila pada periode ini tidak ada pemakaian pada unit itu (jika ada baris pemakaian di periode, masalahnya ditangani baris tsb)
      const mu2 = { ...mu, bahanBelumDicatat: m.length ? 0 : mu.bahanBelumDicatat };
      const agg = agregasi(m, mu2);
      return { unitId: u.id, unitCode: u.unitCode, status: u.status, kelengkapan: mu.kelengkapan ?? [], pernyataan: !!mu.pernyataan, selesaiPada: selesaiTs.get(u.id)?.at ?? null, agg, baris: m };
    });
    const agg = gabungAgregasi(unitAgg.map((x) => x.agg));
    const dinilai = unitAgg.filter((x) => masalah.get(x.unitId)?.dinilai);
    const semuaTanpaBahan = dinilai.length > 0 && dinilai.every((x) => x.pernyataan) && !agg.adaPemakaian;
    const guardLines = unitAgg.flatMap((x) => x.baris).filter((b) => isGuard(b.kode)).length;
    const st = statusBiaya(agg, { semuaTanpaBahan });
    orders.push({
      orderId, orderNumber: us[0] ? unitById.get(us[0].id).order.orderNumber : null, pelanggan: unitById.get(us[0].id).order.customer?.name ?? null, statusOrder: unitById.get(us[0].id).order.status,
      unitDalamOrder: us.length, unitDikerjakan: unitAgg.filter((x) => x.agg.baris > 0 || (selesaiTs.get(x.unitId) && dalam(selesaiTs.get(x.unitId).key, periode))).length,
      barisPemakaian: agg.baris, nilaiDiketahui: izinHarga ? agg.nilaiDiketahui : null, susut: izinHarga ? agg.susut : null,
      status: st.key, statusLabel: st.label, jumlahMasalah: agg.jumlahMasalah, masalah: agg.masalah, adaGuard: guardLines > 0, unit: unitAgg,
      terakhirDipakai: unitAgg.flatMap((x) => x.baris).map((b) => b.tanggalPemakaian).sort().pop() ?? null,
    });
  }
  return { orders, barisUnit };
}

/** Filter + urut atas SELURUH hasil (dipakai tampilan, grafik, dan ekspor — satu jalur). */
export function saringUrutOrder(orders, { q = "", status = "", masalah = "", urut = "masalah" } = {}) {
  const kata = String(q).trim().toLowerCase();
  let hasil = orders;
  if (kata) hasil = hasil.filter((o) => String(o.orderNumber ?? "").toLowerCase().includes(kata) || String(o.pelanggan ?? "").toLowerCase().includes(kata) || o.unit.some((u) => u.unitCode.toLowerCase().includes(kata)));
  const st = String(status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (st.length) hasil = hasil.filter((o) => st.includes(o.status));
  if (masalah === "ada") hasil = hasil.filter((o) => o.jumlahMasalah > 0);
  else if (MASALAH_URUT.includes(masalah)) hasil = hasil.filter((o) => (o.masalah[masalah] ?? 0) > 0);
  const cmp = {
    masalah: (a, b) => b.jumlahMasalah - a.jumlahMasalah || String(b.orderNumber).localeCompare(String(a.orderNumber)),
    nilai: (a, b) => (b.nilaiDiketahui ?? 0) - (a.nilaiDiketahui ?? 0) || String(b.orderNumber).localeCompare(String(a.orderNumber)),
    order: (a, b) => String(b.orderNumber).localeCompare(String(a.orderNumber)),
    terlama: (a, b) => String(a.terakhirDipakai ?? "9999").localeCompare(String(b.terakhirDipakai ?? "9999")) || String(a.orderNumber).localeCompare(String(b.orderNumber)),
  }[urut] ?? null;
  return cmp ? [...hasil].sort(cmp) : hasil;
}

/** Ringkasan seluruh hasil (setelah filter): dipakai kartu, grafik, dan baris TOTAL Excel. */
export function ringkasOrder(orders) {
  const unitSet = new Set(); let pemakaian = 0; let nilai = 0; let susut = 0; let masalah = 0;
  const per = { LENGKAP: 0, PARSIAL: 0, BELUM_DIKETAHUI: 0 };
  const jenis = Object.fromEntries(MASALAH_URUT.map((k) => [k, 0]));
  for (const o of orders) {
    per[o.status] += 1; pemakaian += o.barisPemakaian; nilai += o.nilaiDiketahui ?? 0; susut += o.susut ?? 0; masalah += o.jumlahMasalah;
    for (const u of o.unit) unitSet.add(u.unitId);
    for (const k of MASALAH_URUT) jenis[k] += o.masalah[k] ?? 0;
  }
  return { order: orders.length, unit: unitSet.size, barisPemakaian: pemakaian, nilaiDiketahui: Math.round(nilai * 100) / 100, susut: Math.round(susut * 100) / 100, jumlahMasalah: masalah, perStatus: per, perJenisMasalah: jenis };
}

/** Rincian satu order: bahan per unit (jumlah, satuan, harga, subtotal, tanggal dasar harga, sumber, pengembalian/koreksi) + gap tindak lanjut. Agregasi order = Σ unit. */
export function rincianOrder(order, { izinHarga = false } = {}) {
  const unit = order.unit.map((u) => ({
    unitId: u.unitId, unitCode: u.unitCode, status: u.status, selesaiPada: u.selesaiPada, kelengkapan: u.kelengkapan, pernyataanTanpaBahan: u.pernyataan,
    ringkas: { nilaiDiketahui: izinHarga ? u.agg.nilaiDiketahui : null, susut: izinHarga ? u.agg.susut : null, barisPemakaian: u.agg.baris, jumlahMasalah: u.agg.jumlahMasalah, masalah: u.agg.masalah },
    bahan: u.baris.map((b) => ({
      movementId: b.movementId, kode: b.kode, bahan: b.bahan, jenis: b.jenis, qty: b.qty, arah: b.arah, satuan: b.satuan,
      harga: izinHarga ? b.harga : null, subtotal: izinHarga ? b.subtotal : null, status: b.status, termasukHpp: b.termasukHpp,
      tanggalPemakaian: b.tanggalPemakaian, dasarTanggal: b.dasarTanggal, waktuPencatatan: b.waktuPencatatan, tanggalDasarHarga: b.dasarHargaTanggal,
      sumberHarga: b.sumberHarga, basisHarga: b.basisHarga, labelBukti: b.labelBukti, koreksiDari: b.koreksiDari, catatan: b.catatan,
    })),
  }));
  const total = gabungAgregasi(order.unit.map((u) => u.agg));
  return {
    orderId: order.orderId, orderNumber: order.orderNumber, pelanggan: order.pelanggan, status: order.status, statusLabel: order.statusLabel, jumlahMasalah: order.jumlahMasalah, masalah: order.masalah,
    total: { nilaiDiketahui: izinHarga ? total.nilaiDiketahui : null, susut: izinHarga ? total.susut : null, barisPemakaian: total.baris },
    unit, adaGuard: order.adaGuard,
  };
}

// ───────────────────────────────────────────── KINERJA ─────────────────────────────────────────────
export async function kinerja(prisma, ctx, { dasar = "meja", peran = "MEJA" } = {}) {
  const { periode, units, unitById, timelines, selesaiTs } = ctx;
  const selesaiUnits = []; for (const [unitId, s] of selesaiTs) if (dalam(s.key, periode) && unitById.has(unitId)) selesaiUnits.push({ unitId, ...s });
  const tertentu = units.filter((u) => ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(u.status));
  const tanpaWaktu = tertentu.filter((u) => !selesaiTs.has(u.id)).length; // status Siap Kirim+ tetapi tidak ada waktu serah barang jadi → tidak masuk periode mana pun
  const ids = [...new Set([...selesaiUnits.map((s) => s.unitId)])];
  // penetapan terakhir per unit: rencana V2 (meja + PIC meja + PIC corner) dan jadwal langsung (meja)
  const [rencana, jadwal, operators] = await Promise.all([
    prisma.productionRunPlan.findMany({ where: { run: { unitId: { in: ids } }, status: { not: "CANCELLED" } }, orderBy: [{ updatedAt: "desc" }], select: { operatorId: true, cornerOperatorId: true, stationCode: true, productionDate: true, run: { select: { unitId: true } } } }),
    prisma.productionUnitSchedule.findMany({ where: { unitId: { in: ids }, status: { in: ["ACTIVE", "ADOPTED"] } }, select: { unitId: true, stationCode: true, productionDate: true } }),
    prisma.productionOperator.findMany({ select: { id: true, user: { select: { name: true } } } }),
  ]);
  const nama = new Map(operators.map((o) => [o.id, o.user?.name ?? "—"]));
  const planPerUnit = new Map(); for (const p of rencana) if (!planPerUnit.has(p.run.unitId)) planPerUnit.set(p.run.unitId, p);
  const jadwalPerUnit = new Map(jadwal.map((j) => [j.unitId, j]));
  const stasiun = (id) => planPerUnit.get(id)?.stationCode ?? jadwalPerUnit.get(id)?.stationCode ?? null;
  const picMeja = (id) => planPerUnit.get(id)?.operatorId ?? null;
  const picCorner = (id) => planPerUnit.get(id)?.cornerOperatorId ?? null;
  const grupMeja = kelompokkanSelesai(selesaiUnits, (u) => stasiun(u.unitId), stationLabel);
  const grupPic = kelompokkanSelesai(selesaiUnits, (u) => (peran === "CORNER" ? picCorner(u.unitId) : picMeja(u.unitId)), (k) => nama.get(k) ?? "—");
  // durasi produksi (mulai produksi → serah barang jadi): HANYA bila kedua waktu tercatat; tidak pernah 0 buatan
  const durasiPer = (daftarUnit) => rataDurasi(daftarUnit.map((id) => { const t = timelines.get(id); const a = stempel(t, "productionStartedAt"); const b = stempel(t, "productionFinishedAt"); return a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : NaN; }));
  const tambah = (g) => ({ ...g, durasi: durasiPer(g.unitIds) });
  // rencana (terjadwal) dalam periode — dari jadwal langsung + rencana V2
  const jadwalPeriode = await prisma.productionUnitSchedule.findMany({ where: { status: { in: ["ACTIVE", "ADOPTED"] }, productionDate: { gte: new Date(`${periode.from}T00:00:00.000Z`), lte: new Date(`${periode.to}T00:00:00.000Z`) } }, select: { unitId: true, stationCode: true, productionDate: true } });
  const rencanaPeriode = await prisma.productionRunPlan.findMany({ where: { status: { not: "CANCELLED" }, productionDate: { gte: new Date(`${periode.from}T00:00:00.000Z`), lte: new Date(`${periode.to}T00:00:00.000Z`) } }, select: { stationCode: true, productionDate: true, run: { select: { unitId: true } } } });
  const terjadwal = new Map(); // unitId → {station, tanggal}; satu unit satu entri (rencana V2 menggantikan jadwal langsung bila ADOPTED)
  for (const j of jadwalPeriode) terjadwal.set(j.unitId, { station: j.stationCode, tanggal: j.productionDate.toISOString().slice(0, 10) });
  for (const p of rencanaPeriode) terjadwal.set(p.run.unitId, { station: p.stationCode, tanggal: p.productionDate.toISOString().slice(0, 10) });
  const perMejaJadwal = new Map(); const hariPerMeja = new Map();
  for (const [, t] of terjadwal) { if (!t.station) continue; perMejaJadwal.set(t.station, (perMejaJadwal.get(t.station) ?? 0) + 1); if (!hariPerMeja.has(t.station)) hariPerMeja.set(t.station, new Set()); hariPerMeja.get(t.station).add(t.tanggal); }
  const mejaKodes = [...new Set([...BOARD_DEFAULTS.stations, ...perMejaJadwal.keys(), ...grupMeja.map((g) => g.key).filter((k) => k !== "__TIDAK_TERCATAT__")])];
  const meja = mejaKodes.map((kode) => {
    const g = grupMeja.find((x) => x.key === kode); const hari = hariPerMeja.get(kode)?.size ?? 0; const kap = hari * BOARD_DEFAULTS.capacityPerStation;
    return { kode, label: stationLabel(kode), terjadwal: perMejaJadwal.get(kode) ?? 0, hariBerjadwal: hari, kapasitasRencana: kap || null, rencanaTerisiPct: kap ? Math.round(((perMejaJadwal.get(kode) ?? 0) / kap) * 100) : null, selesai: g?.selesai ?? 0, durasi: g ? durasiPer(g.unitIds) : durasiPer([]) };
  });
  const tdk = grupMeja.find((g) => g.key === "__TIDAK_TERCATAT__");
  // target historis: hanya bila ADA baris target tercatat; selain itu "belum tersedia" (bukan angka konfigurasi yang diklaim historis)
  const targetRows = await prisma.productionDailyTarget.count();
  // QC: hasil inspeksi pada periode (bukan skor); tidak ada → belum tersedia
  const qcRows = await prisma.qualityInspection.groupBy({ by: ["result"], where: { inspectedAt: { gte: periode.start, lt: periode.endExclusive } }, _count: { _all: true } });
  const qc = qcRows.length ? Object.fromEntries(qcRows.map((r) => [r.result, r._count._all])) : null;
  const perHari = new Map(); for (const s of selesaiUnits) perHari.set(s.key, (perHari.get(s.key) ?? 0) + 1);
  return {
    selesai: { unit: selesaiUnits.length, tanpaWaktuTercatat: tanpaWaktu, durasi: durasiPer(selesaiUnits.map((s) => s.unitId)), perHari: seriHarian(periode.hari, perHari) },
    terjadwal: { unit: terjadwal.size, kapasitasPerMejaPerHari: BOARD_DEFAULTS.capacityPerStation },
    meja: { baris: meja.map((m) => ({ ...m, durasi: m.durasi })), tidakTercatat: { selesai: tdk?.selesai ?? 0 }, totalSelesai: selesaiUnits.length },
    pic: { peran, baris: grupPic.map(tambah).map((g) => ({ key: g.key, label: g.label, selesai: g.selesai, durasi: g.durasi, unitIds: g.unitIds })), catatan: "PIC = pekerja yang ditetapkan pada rencana produksi (bukan pelaku posting bahan). Unit tanpa penetapan masuk 'Tidak tercatat'." },
    targetHistoris: targetRows > 0 ? { tersedia: true } : { tersedia: false, catatan: "Target harian historis belum tersedia (belum ada target tercatat). Target bawaan sistem tidak dipakai sebagai pembanding." },
    qc: qc ? { tersedia: true, hasil: qc } : { tersedia: false, catatan: "Hasil QC pada periode ini belum tersedia." },
    cakupan: { selesaiTercatat: selesaiUnits.length, statusSelesaiTanpaWaktu: tanpaWaktu, mejaTidakTercatat: tdk?.selesai ?? 0, picMejaTidakTercatat: grupPic.find((g) => g.key === "__TIDAK_TERCATAT__")?.selesai ?? 0 },
    _selesai: selesaiUnits,
  };
}

// ───────────────────────────────────────────── BAHAN & GUDANG ─────────────────────────────────────────────
const STATUS_MENUNGGU = ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"];
export async function bahanGudang(prisma, ctx, { izinHarga = false, q = "" } = {}) {
  const { periode, movPeriode, unitById } = ctx;
  const perBahan = new Map();
  for (const b of movPeriode) {
    if (!unitById.has(b.unitId)) continue;
    if (!perBahan.has(b.materialId)) perBahan.set(b.materialId, { materialId: b.materialId, kode: b.kode, bahan: b.bahan, satuan: b.satuan, dipakai: 0, dikembalikan: 0, koreksi: 0, susut: 0, nilaiDiketahui: 0, baris: [], unit: new Set() });
    const r = perBahan.get(b.materialId); const q4 = b.qty * (b.arah === "KELUAR" ? -1 : 1);
    if (b.tipe === "ISSUE") r.dipakai += Math.abs(q4); else if (b.tipe === "RETURN") r.dikembalikan += Math.abs(q4); else if (b.tipe === "WASTE") r.susut += Math.abs(q4); else r.koreksi += q4;
    if (b.termasukHpp && !isGuard(b.kode)) r.nilaiDiketahui += b.subtotal;
    r.baris.push(b); r.unit.add(b.unitId);
  }
  const kata = String(q).trim().toLowerCase();
  let bahan = [...perBahan.values()].map((r) => {
    const mp = { BELUM_DIBEKUKAN: 0, TANPA_HARGA: 0, GAGAL: 0, GUARD: 0 };
    for (const b of r.baris) if (b.status in mp) mp[b.status] += 1;
    const masalah = mp.BELUM_DIBEKUKAN + mp.TANPA_HARGA + mp.GAGAL + mp.GUARD;
    return { materialId: r.materialId, kode: r.kode, bahan: r.bahan, satuan: r.satuan, dipakai: round4(r.dipakai), dikembalikan: round4(r.dikembalikan), koreksi: round4(r.koreksi), susut: round4(r.susut), bersih: round4(r.dipakai - r.dikembalikan + r.koreksi), unit: r.unit.size, nilaiDiketahui: izinHarga ? Math.round(r.nilaiDiketahui * 100) / 100 : null, masalah, rincianMasalah: mp, guard: isGuard(r.kode) };
  });
  if (kata) bahan = bahan.filter((b) => b.kode.toLowerCase().includes(kata) || b.bahan.toLowerCase().includes(kata));
  bahan.sort((a, b) => b.masalah - a.masalah || (b.nilaiDiketahui ?? 0) - (a.nilaiDiketahui ?? 0) || a.kode.localeCompare(b.kode));
  const mi = await prisma.materialIssue.findMany({ where: { unitId: { not: null }, status: { not: "CANCELLED" } }, select: { id: true, status: true, createdAt: true, issuedAt: true, requiredDate: true } });
  const dibuat = mi.filter((m) => dalam(wibKeyDari(m.createdAt), periode));
  const diterbitkan = mi.filter((m) => m.issuedAt && dalam(wibKeyDari(m.issuedAt), periode));
  const menunggu = mi.filter((m) => STATUS_MENUNGGU.includes(m.status));
  const responMenit = diterbitkan.map((m) => Math.round((new Date(m.issuedAt) - new Date(m.createdAt)) / 60000));
  const kel = await hitungKelengkapanDaftar(prisma, {});
  return {
    permintaan: { dibuatPeriode: dibuat.length, diterbitkanPeriode: diterbitkan.length, menungguSaatIni: menunggu.length, responPermintaan: rataDurasi(responMenit), perStatusSaatIni: Object.fromEntries(STATUS_MENUNGGU.map((s) => [s, mi.filter((m) => m.status === s).length])) },
    kelengkapan: { dasar: "Posisi saat ini, seluruh unit non-batal", bahanBelumDicatat: kel.counts.BAHAN_BELUM_DICATAT ?? 0, bahanPerluDicek: kel.counts.BAHAN_PERLU_DICEK ?? 0, hppBelumLengkap: kel.counts.HPP_BELUM_LENGKAP ?? 0, unitBerkekurangan: kel.unik, totalUnit: kel.totalUnit },
    bahan,
    total: { bahan: bahan.length, dipakaiBaris: movPeriode.length, masalah: bahan.reduce((a, b) => a + b.masalah, 0), nilaiDiketahui: izinHarga ? Math.round(bahan.reduce((a, b) => a + (b.nilaiDiketahui ?? 0), 0) * 100) / 100 : null },
  };
}
const round4 = (v) => Math.round(v * 10000) / 10000;

// ───────────────────────────────────────────── RINGKASAN ─────────────────────────────────────────────
export async function ringkasan(prisma, ctx, { izinHarga = false } = {}) {
  const { periode } = ctx;
  const { orders } = await biayaPerOrder(prisma, ctx, { izinHarga });
  const tot = ringkasOrder(orders);
  const [kin, gud] = await Promise.all([kinerja(prisma, ctx), bahanGudang(prisma, ctx, { izinHarga })]);
  const hppHarian = new Map(); const barisHarian = new Map();
  for (const b of ctx.movPeriode) { barisHarian.set(b.tanggalPemakaian, (barisHarian.get(b.tanggalPemakaian) ?? 0) + 1); if (b.termasukHpp && !isGuard(b.kode)) hppHarian.set(b.tanggalPemakaian, (hppHarian.get(b.tanggalPemakaian) ?? 0) + b.subtotal); }
  return {
    periode: { from: periode.from, to: periode.to, days: periode.days },
    kartu: {
      orderDikerjakan: { order: tot.order, unit: tot.unit, barisPemakaian: tot.barisPemakaian },
      hppDiketahui: izinHarga ? { nilai: tot.nilaiDiketahui, orderLengkap: tot.perStatus.LENGKAP, orderParsial: tot.perStatus.PARSIAL, orderBelumDiketahui: tot.perStatus.BELUM_DIKETAHUI } : null,
      masalah: { jumlah: tot.jumlahMasalah, perJenis: tot.perJenisMasalah, orderBermasalah: tot.order - tot.perStatus.LENGKAP },
      selesai: { unit: kin.selesai.unit, tanpaWaktuTercatat: kin.selesai.tanpaWaktuTercatat },
      permintaanMenunggu: gud.permintaan.menungguSaatIni,
      kelengkapan: gud.kelengkapan,
    },
    grafik: {
      selesaiPerHari: kin.selesai.perHari,
      biayaPerHari: izinHarga ? seriHarian(periode.hari, hppHarian) : seriHarian(periode.hari, barisHarian),
      biayaPerHariJenis: izinHarga ? "hpp" : "baris",
    },
    perStatusOrder: tot.perStatus,
  };
}
