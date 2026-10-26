// PERUBAHAN PEMAKAIAN per bahan dari tabel "Pemakaian aktual" drawer order (Okt 2026): UBAH JUMLAH dan GANTI BAHAN pada unit berjalan ATAU terkirim.
// Hanya memakai jalur stok resmi: pergerakan RETURN/ISSUE bertaut unit lewat postStockMovement (kunci bahan, invarian saldo, valuasi Finance, HPP operasional beku). Ledger TIDAK PERNAH ditimpa atau dihapus —
// pergerakan lama utuh, perubahan = baris BARU dengan alasan. Dua jalur dipisah tegas:
//   LANGSUNG : unit terkirim, atau unit berjalan dengan bahan yang dicatat langsung (bukan dokumen Material Issue) -> disimpan sekarang, atomik (satu transaksi; ganti bahan = pengembalian + pengeluaran SEKALIGUS atau tidak sama sekali).
//   AJUKAN   : jumlah bahan dari dokumen Material Issue pada unit berjalan, akun tanpa izin tulis langsung, atau pengguna memilih persetujuan -> koreksi pemakaian berpersetujuan yang SUDAH ada (penyetuju ≠ pemohon); stok belum berubah sebelum disetujui.
// Harga HPP operasional: unit terkirim = Harga Berlaku pada TANGGAL PEMAKAIAN YANG DILAPORKAN (aturan live; catatan baku memuat tanggalnya); unit berjalan = saat pencatatan. Retur bertaut = harga ISSUE asal. Jurnal Finance = hari pencatatan.
// Pratinjau memakai fungsi yang SAMA dengan penerapan (legStok/hppPembetulan) dan penerapan menegakkan di server: pemakaian bersih, saldo tiap bahan, dan dasar harga harus sama dengan yang dilihat pengguna.
import { createHash } from "node:crypto";
import { lockMaterialBalance, postStockMovement } from "./inventoryLedger.js";
import { bukukanNilaiPergerakanBaru } from "./finance/posting/inventory.js";
import { guardV1UnitWrite } from "./unitV2Ownership.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { STATUS } from "./warehouseCorrection.js";
import { PembetulanError, bangunWaktu, catatanPembetulan, legStok, tanggalDilaporkan, unitSelesai } from "./pembetulanBahanUnit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const EPS = 1e-6;
const wajib = (c, m, code, status = 400, detail = null) => { if (!c) throw new PembetulanError(m, status, code, detail); };
const bahanRingkas = (m) => ({ id: m.id, kode: m.code, nama: m.name, satuan: m.unit });

function bacaQty(v, label, { boleh0 }) {
  const q = Number(v);
  wajib(Number.isFinite(q) && (boleh0 ? q >= 0 : q > 0) && q <= 1_000_000, `${label} harus angka ${boleh0 ? "0 atau lebih" : "lebih dari 0"}`, "QTY_TIDAK_VALID");
  wajib(Math.abs(r4(q) - q) < 1e-9, "Jumlah maksimum 4 angka di belakang koma", "DESIMAL_BERLEBIH");
  return q;
}

/**
 * Rencana + pratinjau SATU perubahan pemakaian. Baca-saja. mode: UBAH_JUMLAH (materialId → qtyBaru) | GANTI_BAHAN (materialId → qtyBaru [default 0] dan keMaterialId dikeluarkan sebanyak qtyKe).
 * ringan = dipakai DI DALAM transaksi penerapan (saldo ledger saja).
 */
export async function rencanaPerubahan(db, user, { unitId, materialId, qtyBaru, keMaterialId = null, qtyKe = null, tanggalPemakaian = null, ajukan = false } = {}, { sekarang = new Date(), ringan = false } = {}) {
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, createdAt: true, orderId: true, order: { select: { orderNumber: true, status: true } } } });
  wajib(unit, "Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  wajib(unit.status !== "CANCELLED", "Unit ini dibatalkan; pemakaian bahannya tidak diubah lagi.", "UNIT_DIBATALKAN", 409);
  const selesai = unitSelesai(unit.status);
  const tgl = selesai ? tanggalDilaporkan(tanggalPemakaian, { unitDibuat: unit.createdAt, sekarang }) : null;
  const waktu = bangunWaktu(tgl, sekarang);
  const mode = keMaterialId ? "GANTI_BAHAN" : "UBAH_JUMLAH";
  const dari = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
  wajib(dari, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const qb = bacaQty(qtyBaru ?? 0, "Jumlah yang benar", { boleh0: true });
  const net = await db.stockMovement.aggregate({ where: { unitId, materialId, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, _sum: { qty: true } });
  const bersih = r4(-Number(net._sum.qty ?? 0));
  const adaMI = (await db.stockMovement.count({ where: { unitId, materialId, type: "ISSUE", materialIssueId: { not: null } } })) > 0;
  const adaWaste = (await db.stockMovement.count({ where: { unitId, materialId, type: "WASTE" } })) > 0;
  const tertunda = await db.warehouseCorrection.count({ where: { docType: "UNIT_USAGE", docId: unitId, status: STATUS.PENDING } });
  const penghalang = [];
  if (bersih <= EPS) penghalang.push({ kode: "TIDAK_ADA_PEMAKAIAN", pesan: `Bahan ${dari.code} belum tercatat dipakai pada unit ini — tidak ada yang diubah. Gunakan “+ Tambah pemakaian”.` });
  let ke = null; let qk = null;
  if (mode === "GANTI_BAHAN") {
    wajib(UUID.test(String(keMaterialId)), "bahan pengganti tidak valid", "BAHAN_TIDAK_VALID");
    ke = await db.material.findUnique({ where: { id: keMaterialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
    wajib(ke, "Bahan pengganti tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
    qk = bacaQty(qtyKe, "Jumlah bahan pengganti", { boleh0: false });
    if (keMaterialId === materialId) penghalang.push({ kode: "BAHAN_SAMA", pesan: "Bahan pengganti sama dengan bahan lama. Untuk mengubah jumlah, pilih Ubah jumlah." });
    if (bersih > EPS && qb >= bersih - EPS) penghalang.push({ kode: "GANTI_TANPA_PENGEMBALIAN", pesan: "Jumlah bahan lama yang tetap dipakai harus kurang dari pemakaian sekarang. Isi 0 bila bahan lama tidak jadi dipakai sama sekali." });
  } else if (bersih > EPS && Math.abs(qb - bersih) < EPS) penghalang.push({ kode: "TIDAK_ADA_PERUBAHAN", pesan: "Jumlah yang benar sama dengan yang tercatat." });

  const bolehLangsung = hasPermission(user, P.UNIT_MATERIAL_WRITE);
  const bolehAjukan = bolehLangsung || hasPermission(user, P.INVENTORY_WRITE);
  let jalur = "LANGSUNG";
  if (mode === "UBAH_JUMLAH" && (ajukan === true || (!selesai && adaMI) || !bolehLangsung)) jalur = "AJUKAN";
  if (mode === "GANTI_BAHAN") {
    if (!selesai && adaMI) penghalang.push({ kode: "GANTI_BAHAN_DOKUMEN_GUDANG", pesan: `Bahan ${dari.code} dikeluarkan lewat dokumen Material Issue Gudang. Mengganti bahannya dilakukan lewat Gudang (Return Produksi); jumlahnya masih bisa diubah lewat “Ajukan perubahan”.` });
    if (!bolehLangsung) penghalang.push({ kode: "TANPA_IZIN", pesan: "Akun Anda tidak boleh mengganti bahan secara langsung." });
  }
  if (jalur === "AJUKAN") {
    wajib(bolehAjukan, "Akun Anda tidak boleh mengajukan perubahan pemakaian", "TANPA_IZIN", 403);
    if (adaWaste) penghalang.push({ kode: "PERUBAHAN_ADA_SISA_RUSAK", pesan: "Pemakaian bahan ini mencakup catatan sisa/rusak; ajukan perubahan lewat Gudang." });
    if (tertunda > 0) penghalang.push({ kode: "KOREKSI_TERTUNDA", pesan: "Masih ada koreksi pemakaian yang menunggu persetujuan untuk unit ini. Selesaikan atau batalkan dulu." });
  }

  const langkahDasar = [];
  if (bersih > EPS) {
    if (mode === "UBAH_JUMLAH") { const delta = r4(qb - bersih); if (Math.abs(delta) >= EPS) langkahDasar.push({ jenis: delta > 0 ? "TAMBAH" : "KURANGI", m: dari, q: Math.abs(delta) }); }
    else if (qb < bersih - EPS) { langkahDasar.push({ jenis: "KURANGI", m: dari, q: r4(bersih - qb) }); langkahDasar.push({ jenis: "TAMBAH", m: ke, q: qk }); }
  }
  const langkah = [];
  for (const l of langkahDasar) {
    const r = await legStok(db, { unit, m: l.m, jenis: l.jenis, q: l.q, tanggal: tgl?.tanggal ?? null, sekarang, waktu: null, ringan, abaikanTertaut: true });
    langkah.push({ urutan: langkah.length + 1, jenis: l.jenis === "TAMBAH" ? "ISSUE" : "RETURN", bahan: bahanRingkas(l.m), qty: l.q, ...r });
    for (const h of r.penghalang) penghalang.push({ ...h, bahan: l.m.code, pesan: `${l.m.code}: ${h.pesan}` });
  }
  const ringkas = [];
  if (mode === "UBAH_JUMLAH") ringkas.push(`Ubah jumlah ${dari.name} pada ${unit.unitCode}: ${bersih} → ${qb} ${dari.unit}.`);
  else ringkas.push(`Ganti bahan pada ${unit.unitCode}: ${dari.name} ${bersih} → ${qb} ${dari.unit} (${r4(Math.max(bersih - qb, 0))} ${dari.unit} dikembalikan ke stok), lalu ${ke.name} ${qk} ${ke.unit} dikeluarkan dari stok.`);
  if (jalur === "AJUKAN") ringkas.push("Ini PENGAJUAN: stok belum berubah sampai Owner/Finance (orang lain dari pemohon) menyetujui. Setelah disetujui, pergerakan tercatat sebagai baris baru bertaut pemakaian asal.");
  else if (mode === "GANTI_BAHAN") ringkas.push("Dua langkah resmi (pengembalian bahan lama, pengeluaran bahan baru) disimpan SEKALIGUS dalam satu transaksi: bila salah satu ditolak, tidak ada yang tersimpan.");
  else ringkas.push("Disimpan sekarang sebagai baris BARU di riwayat (pengembalian atau pengeluaran); baris lama tidak diubah atau dihapus.");
  if (tertunda > 0 && jalur === "LANGSUNG") ringkas.push("Catatan: ada koreksi pemakaian yang masih menunggu persetujuan pada unit ini; perubahan ini dapat membuatnya perlu diajukan ulang.");
  const perluKonfirmasiGanda = langkah.some((l) => l.sudahTercatat?.perluKonfirmasi);
  return {
    unit: { id: unit.id, kode: unit.unitCode, status: unit.status, selesai, order: unit.order?.orderNumber ?? null },
    mode, jalur, waktu, tanggalWajib: selesai,
    dari: { bahan: bahanRingkas(dari), bersihSebelum: bersih, bersihSesudah: qb, dokumenGudang: adaMI }, ke: ke ? { bahan: bahanRingkas(ke), qty: qk } : null,
    langkah, ringkas, penghalang, boleh: penghalang.length === 0 && langkah.length > 0, perluKonfirmasiGanda, tertunda,
    sidik: { bersih, legs: langkah.map((l) => ({ materialId: l.bahan.id, jenis: l.jenis, saldo: l.saldo, hppSidik: l.hppOperasional.sidik })) },
    alasanWajib: true, izin: { bolehLangsung, bolehAjukan, penyetujuKoreksi: "Owner atau Finance (orang lain dari pemohon)" },
  };
}

export async function pratinjauPerubahan(db, user, input) {
  return rencanaPerubahan(db, user, input, { sekarang: new Date() });
}

const ringkasCatatan = (p, l) => {
  const d = p.dari.bahan; const sat = d.satuan;
  if (p.mode === "UBAH_JUMLAH") return `Ubah jumlah ${d.kode}: ${p.dari.bersihSebelum} → ${p.dari.bersihSesudah} ${sat}`;
  return l.jenis === "RETURN" ? `Ganti bahan ${d.kode} → ${p.ke.bahan.kode} (1/2: kembali ${l.qty} ${sat})` : `Ganti bahan ${d.kode} → ${p.ke.bahan.kode} (2/2: keluar ${l.qty} ${p.ke.bahan.satuan})`;
};

/**
 * Terapkan perubahan LANGSUNG, atomik. Idempotency-Key (12–128) wajib: klik ganda/retry = satu hasil. Gagal di langkah mana pun = seluruh transaksi dibatalkan (tidak ada hasil setengah jadi).
 * dilihat = { bersih, legs: [{ materialId, jenis, saldo, hppSidik }] } dari pratinjau; server membandingkan dengan keadaan SEKARANG di bawah kunci bahan.
 */
export async function terapkanPerubahanPemakaian(prisma, user, input, { kunci } = {}) {
  const k = String(kunci ?? "").trim();
  wajib(k.length >= 12 && k.length <= 128, "Idempotency-Key wajib (12–128 karakter)", "IDEMPOTENCY_KEY_INVALID", 400);
  const { unitId, materialId, keMaterialId = null } = input;
  wajib(UUID.test(String(unitId ?? "")) && UUID.test(String(materialId ?? "")), "unit atau bahan tidak valid", "UNIT_TIDAK_VALID");
  const alasan = String(input.alasan ?? "").trim();
  wajib(alasan.length >= 5 && alasan.length <= 500, "Alasan wajib diisi (5–500 karakter)", "UNIT_ALASAN_PEMBETULAN_WAJIB");
  const dilihat = input.dilihat;
  wajib(dilihat && Array.isArray(dilihat.legs) && Number.isFinite(Number(dilihat.bersih)), "Lihat dampak dulu: pemakaian, saldo, dan dasar harga dari pratinjau wajib dikirim.", "UNIT_PRATINJAU_WAJIB");
  const requestHash = createHash("sha256").update(JSON.stringify({ unitId, materialId, qtyBaru: Number(input.qtyBaru), keMaterialId, qtyKe: input.qtyKe == null ? null : Number(input.qtyKe), alasan, tanggal: input.tanggalPemakaian ?? null, dilihat })).digest("hex");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.v2Command.create({ data: { domain: "PRODUCTION_V1", actorId: user.id, idempotencyKey: k, commandType: "UNIT_MATERIAL_EDIT_V1", aggregateType: "unit", aggregateId: unitId, requestHash, status: "PROCESSING" } });
      await guardV1UnitWrite(tx, unitId, { what: "perubahan pemakaian bahan", actorId: user.id }); // kunci unit -> kepemilikan -> tulis, satu transaksi
      for (const id of [...new Set([materialId, keMaterialId].filter(Boolean))].sort()) await lockMaterialBalance(tx, id); // urutan kunci tetap: tanpa deadlock antar-perubahan
      const sekarang = new Date();
      const p = await rencanaPerubahan(tx, user, { unitId, materialId, qtyBaru: input.qtyBaru, keMaterialId, qtyKe: input.qtyKe, tanggalPemakaian: input.tanggalPemakaian, ajukan: false }, { sekarang, ringan: true });
      wajib(p.jalur === "LANGSUNG", "Perubahan ini perlu persetujuan orang lain: gunakan “Ajukan perubahan”.", "UNIT_PERLU_PERSETUJUAN", 409);
      wajib(Math.abs(r4(dilihat.bersih) - p.dari.bersihSebelum) <= 0.00005, `Pemakaian bahan ini sudah berubah: pratinjau Anda memakai ${r4(dilihat.bersih)}, sekarang ${p.dari.bersihSebelum}. Lihat dampak lagi; tidak ada yang tersimpan.`, "UNIT_PEMAKAIAN_BERGESER", 409, { dilihat: r4(dilihat.bersih), sekarang: p.dari.bersihSebelum });
      for (const l of p.langkah) {
        const lihat = dilihat.legs.find((x) => x.materialId === l.bahan.id && x.jenis === l.jenis);
        wajib(lihat && Number.isFinite(Number(lihat.saldo)) && typeof lihat.hppSidik === "string", "Lihat dampak dulu: saldo dan dasar harga tiap bahan dari pratinjau wajib dikirim.", "UNIT_PRATINJAU_WAJIB");
        wajib(Math.abs(r4(lihat.saldo) - r4(l.saldo)) <= 0.00005, `Saldo ${l.bahan.kode} sudah bergeser: pratinjau Anda memakai ${r4(lihat.saldo)}, saldo sekarang ${r4(l.saldo)}. Lihat dampak lagi; tidak ada yang tersimpan.`, "UNIT_SALDO_BERGESER", 409, { bahan: l.bahan.kode, saldoDilihat: r4(lihat.saldo), saldoSekarang: r4(l.saldo) });
        wajib(lihat.hppSidik === l.hppOperasional.sidik, `Dasar harga HPP operasional ${l.bahan.kode} berbeda dari pratinjau Anda (tanggal pemakaian atau harga berubah). Lihat dampak lagi; tidak ada yang tersimpan.`, "UNIT_DASAR_HARGA_BERGESER", 409, { bahan: l.bahan.kode, dilihat: lihat.hppSidik, sekarang: l.hppOperasional.sidik });
      }
      if (p.penghalang.length) throw new PembetulanError(p.penghalang[0].pesan, 409, p.penghalang[0].kode, { penghalang: p.penghalang });
      wajib(p.langkah.length > 0, "Tidak ada perubahan untuk disimpan.", "TIDAK_ADA_PERUBAHAN", 409);
      wajib(!p.perluKonfirmasiGanda || input.konfirmasiBukanGanda === true, "Ada pengeluaran yang mungkin sudah mencatat pemakaian yang sama. Periksa daftarnya, lalu konfirmasi bahwa ini pengeluaran BARU.", "UNIT_KEMUNGKINAN_GANDA", 409);
      const tanggal = p.waktu.pemakaianDilaporkan; const hasilLangkah = [];
      for (const l of p.langkah) { // urutan: pengembalian (menambah stok) lebih dulu, lalu pengeluaran
        const ringkas = ringkasCatatan(p, l);
        const note = tanggal ? catatanPembetulan(p.unit.kode, alasan, tanggal, ringkas) : `Perubahan pemakaian (${p.unit.kode}): ${alasan} | ${ringkas}`.slice(0, 500);
        const mv = await postStockMovement(tx, { materialId: l.bahan.id, type: l.jenis, qty: l.jenis === "ISSUE" ? -l.qty : l.qty, unitId, note, createdById: user.id });
        await bukukanNilaiPergerakanBaru(tx, mv, { userId: user.id }); // nilai Finance dibukukan di transaksi yang sama (atau celah tercatat) — sama dengan jalur pemakaian langsung
        hasilLangkah.push({ movementId: mv.id, jenis: l.jenis, materialId: l.bahan.id, qty: l.qty });
      }
      await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_PERUBAHAN_PEMAKAIAN_BAHAN, actorId: user.id,
        metadata: { unitCode: p.unit.kode, unitStatus: p.unit.status, mode: p.mode, materialId, keMaterialId, bersihSebelum: p.dari.bersihSebelum, bersihSesudah: p.dari.bersihSesudah, langkah: hasilLangkah, alasan, tanggalPemakaianDilaporkan: tanggal, dasarHargaOperasional: tanggal ? "TANGGAL_PEMAKAIAN_DILAPORKAN" : "WAKTU_PENCATATAN", dicatatPada: sekarang.toISOString(), konfirmasiBukanGanda: input.konfirmasiBukanGanda === true } });
      const hasil = { mode: p.mode, langkah: hasilLangkah, bersihSesudah: p.dari.bersihSesudah };
      await tx.v2Command.update({ where: { actorId_idempotencyKey: { actorId: user.id, idempotencyKey: k } }, data: { status: "APPLIED", response: hasil, completedAt: new Date() } });
      return { ulang: false, ...hasil };
    }, { timeout: 60_000, maxWait: 15_000 });
  } catch (e) {
    if (e?.code === "P2002") {
      const cmd = await prisma.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: user.id, idempotencyKey: k } } });
      if (cmd && cmd.requestHash !== requestHash) throw new PembetulanError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda", 409, "IDEMPOTENCY_KEY_REUSED");
      if (cmd?.response) return { ulang: true, ...cmd.response };
      throw new PembetulanError("Permintaan yang sama sedang diproses; coba lagi sebentar", 409, "IDEMPOTENCY_IN_PROGRESS");
    }
    throw e;
  }
}
