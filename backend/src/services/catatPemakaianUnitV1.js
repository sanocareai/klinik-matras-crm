// PENCATATAN PEMAKAIAN BAHAN UNIT (V1) — dipindah apa adanya dari routes/units.js (POST /units/:id/materials) supaya bisa dijalankan dua cara:
//   langsung oleh pencatat ADMIN (rute), atau SAAT VERIFIKASI pengajuan non-ADMIN (services/pengajuanPemakaian.js) dengan pelaku = pengaju dan waktu pemakaian = waktu pengajuan.
// Semua pemeriksaan lama (satuan pakai, saldo, pembetulan unit terkirim, pengaman pra-SO, pengecualian stok, idempotensi v2Command) tetap di sini dan berjalan lagi saat verifikasi.
import { createHash } from "node:crypto";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { postStockMovement } from "./inventoryLedger.js";
import { bukukanNilaiPergerakanBaru } from "./finance/posting/inventory.js";
import { guardV1UnitWrite, UnitConflictError, UUID_RE } from "./unitV2Ownership.js";
import { alasanPembetulan, catatanPembetulan, uraiCatatanPembetulan, tanggalDilaporkan, periksaPembetulanLangsung, unitSelesai, alasanPengecualian, bolehPengecualianStok, periksaCutoffOpname, PembetulanError, PREFIKS_ALASAN_PENGECUALIAN } from "./pembetulanBahanUnit.js";
import { aturanUntukBahan, konversiKeStok } from "../lib/domain/satuanPakaiBahan.js";
import { muatAturanSatuanPakai } from "./satuanPakaiService.js";
import { prisma } from "../db.js";

class CobaSajaSelesai extends Error { constructor() { super("coba-saja"); } }

function handleEngineError(err, res) {
  // Duck-typed, bukan cuma `instanceof StageTransitionError` — supaya
  // LedgerError dari services/inventoryLedger.js (POST /:id/materials,
  // "stok tidak cukup") juga dijawab 400 yang jelas, bukan bocor ke 500
  // generik di bawah.
  if (typeof err.statusCode === "number") {
    return res.status(err.statusCode).json({ error: err.message, ...(typeof err.code === "string" && /^(UNIT_|PENGECUALIAN_|SATUAN_|QTY_|PENGAJUAN_|IDEMPOTENCY_)/.test(err.code) ? { code: err.code } : {}), ...(err.current ? { current: err.current } : {}), ...(err.detail && typeof err.code === "string" && /^(UNIT_|PENGECUALIAN_|SATUAN_|QTY_)/.test(err.code) ? { detail: err.detail } : {}) });
  }
  // P2034 = konflik transaksi SERIALIZABLE (Production Core Slice 3I) — dua
  // perintah eksekusi (START/PAUSE/RESUME/COMPLETE) bersamaan pada tahap yang
  // sama, salah satunya kalah lomba. Ini SINYAL SEHAT (Postgres mencegah
  // korupsi data), bukan bug — jawab 409 yang jelas + minta klien coba lagi,
  // JANGAN bocorkan pesan Prisma mentah ke pengguna.
  if (err.code === "P2034") {
    return res.status(409).json({ error: "Ada aksi lain yang bersamaan mengubah tahap ini — coba lagi" });
  }
  console.error("Unit stage engine error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

/** Handler asli (req, res). req._cobaSaja = validasi tanpa menulis; req._waktuPemakaian = createdAt pergerakan (waktu pengajuan). */
export async function catatPemakaianHandler(req, res) {
  try {
    const { materialId, note } = req.body;
    const qtyInput = Number(req.body.qty);
    if (!materialId) return res.status(400).json({ error: "Bahan wajib dipilih" });
    if (!UUID_RE.test(String(materialId))) return res.status(400).json({ error: "ID bahan tidak valid", code: "ID_INVALID" });
    if (!Number.isFinite(qtyInput) || qtyInput === 0) {
      return res.status(400).json({ error: "Jumlah wajib diisi dan tidak boleh nol" });
    }

    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) return res.status(404).json({ error: "Bahan tidak ditemukan" });
    if (!material.active) return res.status(400).json({ error: "Bahan ini sudah nonaktif" });
    // SATUAN PAKAI (keputusan Owner 4 Nov 2026; lib/domain/satuanPakaiBahan.js): bahan beraturan (mis. LIST WIBING: stok ROLL, dipakai METER, 1 ROLL = 90 METER) WAJIB menyebut satuan input;
    // server mengonversi ke satuan STOK sebelum menyentuh ledger. Bahan tanpa aturan: perilaku lama (satuan tidak perlu dikirim). rawQty di bawah = jumlah dalam satuan STOK.
    const aturanSp = aturanUntukBahan(material, await muatAturanSatuanPakai(prisma));
    const kv = konversiKeStok({ qty: qtyInput, satuanInput: req.body.satuan ?? null, aturan: aturanSp, satuanStok: material.unit });
    if (!kv.ok) return res.status(400).json({ error: kv.pesan, code: kv.kode });
    const rawQty = kv.qtyStok;

    const unit = await prisma.unit.findUnique({ where: { id: req.params.id }, select: { id: true, unitCode: true, status: true, orderId: true, createdAt: true } });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });
    // Unit TERKIRIM (bukan dibatalkan): pembetulan bahan lewat jalur resmi ini TETAPI wajib: alasan (body.alasanPembetulan), tanggal pemakaian yang DILAPORKAN (body.tanggalPemakaian, terpisah dari waktu pencatatan),
    // saldo yang dilihat di pratinjau (body.saldoDilihat) dan, bila ada pengeluaran yang mungkin sudah tercatat, konfirmasi eksplisit (body.konfirmasiBukanGanda). Semuanya dicatat di catatan pergerakan + log aktivitas unit. Unit lain: perilaku lama.
    const pembetulan = unitSelesai(unit.status);
    const alasanB = alasanPembetulan(unit.status, req.body.alasanPembetulan);
    const tglB = pembetulan ? tanggalDilaporkan(req.body.tanggalPemakaian, { unitDibuat: unit.createdAt }) : null;
    // Catatan baku pembetulan menentukan DASAR HARGA HPP operasional (finance/hargaBerlaku.js: tanggalDasarHarga): hanya server yang boleh menuliskannya, dan hanya pada unit terkirim.
    if (!pembetulan && uraiCatatanPembetulan(note)) return res.status(400).json({ error: "Catatan tidak boleh diawali format baku 'Pembetulan unit terkirim (…) [dilaporkan …]' — format itu hanya dibuat sistem untuk unit terkirim.", code: "CATATAN_FORMAT_RESERVED" });
    const catatanDasar = [note || null, kv.dikonversi ? kv.catatan : null].filter(Boolean).join(" | ") || null; // penanda konversi satuan pakai ikut tercatat (jumlah yang diketik tidak hilang)
    const catatanB = pembetulan ? catatanPembetulan(unit.unitCode, alasanB, tglB.tanggal, catatanDasar) : (catatanDasar ? catatanDasar.slice(0, 500) : null);
    // PENGECUALIAN STOK TIDAK CUKUP (Nov 2026): hanya pengeluaran pada unit TERKIRIM (pemakaian historis); izin pengelola + alasan + konfirmasi eksplisit diperiksa di sini; cutoff opname dan saldo di dalam transaksi.
    const mintaPengecualian = req.body.pengecualianStokTidakCukup === true;
    let alasanP = null;
    if (mintaPengecualian) {
      if (!pembetulan || rawQty <= 0) return res.status(400).json({ error: "Pengecualian stok tidak cukup hanya untuk pengeluaran pemakaian historis pada unit yang sudah terkirim.", code: "PENGECUALIAN_HANYA_PEMAKAIAN_HISTORIS" });
      if (!bolehPengecualianStok(req.user)) return res.status(403).json({ error: "Pengecualian stok tidak cukup hanya untuk peran pengelola (Admin, Owner, Kepala Produksi).", code: "PENGECUALIAN_STOK_TANPA_IZIN" });
      alasanP = alasanPengecualian(req.body.alasanPengecualianStok);
      if (req.body.konfirmasiSaldoMinus !== true) return res.status(400).json({ error: "Konfirmasi eksplisit wajib: pengeluaran ini tetap mengurangi stok dan dapat membuat saldo minus.", code: "PENGECUALIAN_STOK_KONFIRMASI_WAJIB" });
    }

    // rawQty > 0 → pemakaian tambahan (ISSUE, stok berkurang, ledger negatif).
    // rawQty < 0 → koreksi mengurangi (RETURN, stok bertambah, ledger positif).
    const type = rawQty > 0 ? "ISSUE" : "RETURN";
    const ledgerQty = -rawQty;

    // IDEMPOTENSI (adopsi Admin, Okt 2026): header Idempotency-Key (12–128 karakter) membuat pencatatan pemakaian bahan terjadi TEPAT SEKALI walau diklik ulang, di-retry saat jaringan putus,
    // atau dikirim dua kali bersamaan. Baris perintah (v2_commands, unik per pelaku+kunci) ditulis PERTAMA di transaksi yang sama dengan pergerakan stok: kiriman kedua menunggu lalu gagal P2002
    // dan seluruh transaksinya dibatalkan (tidak ada pergerakan ganda). Tanpa header = perilaku lama (klien lama tidak berubah).
    const kunci = String(req.get("Idempotency-Key") || "").trim();
    if (kunci && (kunci.length < 12 || kunci.length > 128)) return res.status(400).json({ error: "Idempotency-Key harus 12–128 karakter", code: "IDEMPOTENCY_KEY_INVALID" });
    const requestHash = createHash("sha256").update(JSON.stringify({ unitId: unit.id, materialId, qty: rawQty, note: catatanB, ...(pembetulan ? { saldoDilihat: req.body.saldoDilihat ?? null } : {}), ...(aturanSp ? { satuan: kv.satuanInput, qtyInput } : {}), ...(mintaPengecualian ? { pengecualian: alasanP } : {}) })).digest("hex");

    let movement;
    try {
      movement = await prisma.$transaction(async (tx) => {
        if (kunci) await tx.v2Command.create({ data: { domain: "PRODUCTION_V1", actorId: req.user.id, idempotencyKey: kunci, commandType: "UNIT_MATERIAL_USAGE_V1", aggregateType: "unit", aggregateId: unit.id, requestHash, status: "PROCESSING" } });
        if (req._penjaga) await req._penjaga(tx); // dari verifikasi pengajuan: pengajuan masih aktif (terkunci) — penolakan paralel tidak bisa berakhir dengan pergerakan tertulis
        await guardV1UnitWrite(tx, unit.id, { what: "pemakaian bahan", actorId: req.user.id }); // kunci unit -> kepemilikan -> tulis, satu transaksi
        // KOREKSI tidak boleh melebihi pemakaian bersih bahan itu pada unit ini (qty negatif = pengembalian ke stok): mencegah stok "muncul" dari koreksi berlebih. Pemakaian = ISSUE/RETURN/WASTE bertaut unit.
        if (rawQty < 0) {
          const net = await tx.stockMovement.aggregate({ where: { unitId: unit.id, materialId, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, _sum: { qty: true } });
          const dipakai = -Number(net._sum.qty ?? 0);
          if (-rawQty > dipakai + 0.00005) { const e = new Error(`Koreksi ${-rawQty} melebihi pemakaian bersih bahan ini pada unit (${Math.max(dipakai, 0)}). Kurangi jumlah koreksi.`); e.statusCode = 409; e.code = "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN"; throw e; }
        }
        const periksa = pembetulan ? await periksaPembetulanLangsung(tx, { unitId: unit.id, unitCode: unit.unitCode, hppSidik: req.body.hppSidik, orderId: unit.orderId, materialId, rawQty, saldoDilihat: req.body.saldoDilihat, konfirmasiBukanGanda: req.body.konfirmasiBukanGanda, tanggal: tglB.tanggal }) : null;
        // Pengecualian DIPAKAI hanya bila saldo memang tidak cukup (saldo yang dikunci di transaksi ini). Tidak cukup + tanpa pengecualian: ledger menolak seperti biasa.
        let pengecualianDipakai = null;
        if (mintaPengecualian) {
          const saldoSesudah = Math.round((periksa.saldo - rawQty) * 10000) / 10000;
          if (saldoSesudah < -0.000001) {
            const [{ n }] = await tx.$queryRaw`SELECT COUNT(*)::int AS n FROM stock_movements WHERE material_id = ${materialId}::uuid`;
            if (n === 0) throw new PembetulanError(`Bahan ${material.code} belum punya catatan stok sama sekali: saldo BELUM DIKETAHUI (bukan nol/minus) dan tidak dapat dikecualikan. Pakai "Catat sementara — stok belum diketahui" atau minta Gudang mencatat stok awal/opname.`, 409, "PENGECUALIAN_STOK_BELUM_DIKETAHUI");
            const op = await periksaCutoffOpname(tx, { materialId, tanggal: tglB.tanggal });
            if (op.melintasi) throw new PembetulanError(op.teks, 409, "PENGECUALIAN_MELINTASI_OPNAME", { acuan: op.melintasiDaftar });
            pengecualianDipakai = { saldoSebelum: periksa.saldo, saldoSesudah, opnameAcuan: op.acuan[0] ?? null };
          }
        }
        const mv = await postStockMovement(tx, {
          materialId, type, qty: ledgerQty, unitId: unit.id, ...(req._waktuPemakaian ? { createdAt: req._waktuPemakaian } : {}),
          note: catatanB, createdById: req.user.id,
          ...(pengecualianDipakai ? { pengecualianSaldoMinus: { alasan: alasanP, aktorId: req.user.id }, reason: `${PREFIKS_ALASAN_PENGECUALIAN}${alasanP}` } : {}),
        });
        if (pembetulan) await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unit.id, eventType: EVENT_TYPES.PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI, actorId: req.user.id, metadata: { unitCode: unit.unitCode, unitStatus: unit.status, jenis: "PEMBETULAN_BAHAN", movementId: mv.id, materialId, qty: ledgerQty, tipe: type, alasan: alasanB, tanggalPemakaianDilaporkan: tglB.tanggal, dasarHargaOperasional: "TANGGAL_PEMAKAIAN_DILAPORKAN", terlambatHari: tglB.terlambatHari, dicatatPada: new Date().toISOString(), konfirmasiBukanGanda: req.body.konfirmasiBukanGanda === true,
          ...(aturanSp ? { satuanPakai: { qtyInput, satuanInput: kv.satuanInput, qtyStok: rawQty, faktor: kv.faktor, dikonversi: kv.dikonversi } } : {}),
          ...(mintaPengecualian ? { pengecualianStokTidakCukup: { diminta: true, dipakai: !!pengecualianDipakai, alasan: alasanP, ...(pengecualianDipakai ?? {}), tanggalPemakaian: tglB.tanggal, jumlahStok: rawQty, jumlahInput: qtyInput, satuanInput: kv.satuanInput } } : {}) } });
        // HPP: nilai pemakaian/koreksi dibukukan di transaksi yang sama (atau gap terlihat) — jalur ini dulu menulis stok tanpa jejak nilai sama sekali.
        await bukukanNilaiPergerakanBaru(tx, mv, { userId: req.user.id });
        if (req._cobaSaja) throw new CobaSajaSelesai(); // validasi penuh (saldo, satuan, pengaman SO, ganda) lalu ROLLBACK: pengajuan non-ADMIN tidak menulis apa pun
        if (kunci) await tx.v2Command.update({ where: { actorId_idempotencyKey: { actorId: req.user.id, idempotencyKey: kunci } }, data: { status: "APPLIED", response: { movementId: mv.id }, completedAt: new Date() } });
        return mv;
      });
    } catch (e) {
      if (e instanceof CobaSajaSelesai) return res.status(200).json({ cobaSaja: true, lulus: true });
      if (kunci && e?.code === "P2002") {
        const cmd = await prisma.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: req.user.id, idempotencyKey: kunci } } });
        if (cmd && cmd.requestHash !== requestHash) return res.status(409).json({ error: "Idempotency-Key ini sudah dipakai untuk isian yang berbeda", code: "IDEMPOTENCY_KEY_REUSED" });
        const mvId = cmd?.response?.movementId;
        const ada = mvId ? await prisma.stockMovement.findUnique({ where: { id: mvId } }) : null;
        if (ada) { res.setHeader("Idempotent-Replay", "true"); return res.status(200).json(ada); }
        return res.status(409).json({ error: "Permintaan yang sama sedang diproses; coba lagi sebentar", code: "IDEMPOTENCY_IN_PROGRESS" });
      }
      throw e;
    }
    res.status(201).json(movement);
  } catch (err) {
    handleEngineError(err, res);
  }
}

/** Jalankan handler tanpa HTTP. Kembalian { status, body, header }. */
export async function jalankanCatatPemakaian({ user, unitId, body, kunci = null, waktu = null, cobaSaja = false, penjaga = null }) {
  const header = {}; const out = { status: 200, body: null, header };
  const req = { body: body ?? {}, params: { id: unitId }, user, get: (h) => (String(h).toLowerCase() === "idempotency-key" ? kunci : undefined), _waktuPemakaian: waktu, _cobaSaja: cobaSaja, _penjaga: penjaga };
  const res = { status(n) { out.status = n; return this; }, json(b) { out.body = b; return this; }, setHeader(k, v) { header[k] = v; return this; } };
  await catatPemakaianHandler(req, res);
  return out;
}
