// KALIBRASI SALDO RIIL — menyamakan saldo BUKU tiap rekening Kas & Bank ke saldo riil yang dikonfirmasi pemilik pada satu INSTAN
// tertentu (cutoff), lewat SATU jurnal koreksi resmi (postJournal): seimbang, atomik, idempoten, tercatat di audit trail.
//
// TIDAK ada kolom saldo yang diubah, tidak ada jurnal dihapus/diubah, tidak ada transaksi diubah, dan tidak ada sumber saldo
// tandingan. Saldo tetap DIHITUNG dari ledger (services/finance/reports.js#saldoKasBank), jadi transaksi setelah cutoff otomatis
// menambah/mengurangi saldo current.
//
// ── MASALAH WAKTU (kenapa ini tidak sekadar "tanggal ≤ cutoff") ─────────────────────────────────────────────────
// Ledger hanya menyimpan TANGGAL BUKU (`FinJournalEntry.date`, DATE polos) — tanpa jam. Cutoff jatuh di TENGAH hari (19 Sep 20.00 WIB),
// jadi "akhir hari" tidak boleh diasumsikan. Aturan klasifikasi sebuah jurnal (`sebelumCutoff`):
//   • tanggal buku  < tanggal cutoff  → SEBELUM cutoff (kejadiannya bertanggal lebih awal, walau baru dicatat belakangan);
//   • tanggal buku  > tanggal cutoff  → SESUDAH cutoff (mis. seluruh transaksi 20 Sep);
//   • tanggal buku == tanggal cutoff  → dipilah dengan WAKTU POSTING (`postedAt` ?? `createdAt`): ≤ cutoff = sebelum, > = sesudah;
//   • jurnal kalibrasi itu sendiri (idempotencyKey-nya) = SEBELUM cutoff, karena ia MENDEFINISIKAN saldo pada cutoff;
//   • `sebelumDikonfirmasi`: nomor jurnal yang PEMILIK nyatakan terjadi sebelum cutoff walau baru diposting sesudahnya (pengecualian
//     eksplisit & terdaftar — bukan tebakan). Dipakai untuk kejadian nyata yang dicatat mundur; JANGAN dipakai untuk jurnal ganda
//     yang kemudian dibalik (pasangan asli+balikannya harus jatuh di sisi yang sama agar netral).
// Konsekuensi yang harus dilaporkan jujur: jurnal bertanggal buku = tanggal cutoff yang baru diposting SETELAH cutoff (dicatat mundur)
// diperlakukan sebagai transaksi sesudah cutoff; laporan `saldoKasBank({ to: <tanggal cutoff> })` (berbasis tanggal) karena itu bisa
// berbeda dari saldo riil sebesar jurnal-jurnal tersebut. `posisi.catatMundurTanggalCutoff` mendaftarkannya.
//
// Lawan jurnal: akun ekuitas sistem `Koreksi Saldo Awal` (bukan pendapatan, bukan biaya). Tidak pernah dibuat/diubah lewat UI:
// `systemKey` hanya bisa diisi kode (routes/finance.js menolaknya dari input pengguna) dan akun ber-systemKey tidak bisa dinonaktifkan.

import { toMoney, ZERO } from "./money.js";
import { postJournal, findEntryByKey, STATUS_DIHITUNG } from "./journal.js";
import { SYSTEM_KEYS } from "./accounts.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

/** Kalibrasi 19 Sep 2026 20.00 WIB — angka dari pemilik (dikonfirmasi manual), BUKAN dihitung ulang dari saldo sistem. */
export const KALIBRASI_20260919 = Object.freeze({
  kode: "2026-09-19T20:00+07:00",
  cutoff: new Date("2026-09-19T20:00:00+07:00"),
  tanggalBuku: "2026-09-19",
  keterangan: "Kalibrasi saldo riil per 19 September 2026 pukul 20.00 WIB",
  idempotencyKey: "KALIBRASI_SALDO_RIIL:2026-09-19T20:00+07:00",
  // Dikonfirmasi pemilik (20 Sep 2026): dibayar SEBELUM 19 Sep 20.00 WIB, baru diinput 20 Sep siang → sudah tercermin di saldo riil.
  sebelumDikonfirmasi: Object.freeze(["JV-19092026-368" /* Servis mobil ZAE Rp2.515.000 */, "JV-19092026-362" /* Etoll alwan tambahan Rp50.000 */]),
  // Nama rekening di Finance > Rekening Kas & Bank → saldo riil pada cutoff.
  target: Object.freeze({
    "KEM - Sano Bank": "766507.00", // "Kemal Sano"
    "PT Sano": "36870615.00",
    "Uang Kas Sano": "54500.00",
  }),
});

export const AKUN_KOREKSI = Object.freeze({
  code: "3-4100",
  name: "Koreksi Saldo Awal",
  description: "Lawan jurnal kalibrasi saldo kas/bank ke saldo riil (mis. 19 Sep 2026 20.00 WIB). Akun sistem: bukan pendapatan dan bukan biaya. Jangan dipakai untuk transaksi biasa.",
});

const tanggalIso = (d) => new Date(d).toISOString().slice(0, 10);

/** Apakah jurnal ini dihitung SEBELUM (atau tepat pada) cutoff? Lihat aturan di kepala file. */
export function sebelumCutoff(e, konfig = KALIBRASI_20260919) {
  if (e.idempotencyKey && e.idempotencyKey === konfig.idempotencyKey) return true;
  if (e.entryNumber && konfig.sebelumDikonfirmasi?.includes(e.entryNumber)) return true;
  const tgl = tanggalIso(e.date);
  if (tgl < konfig.tanggalBuku) return true;
  if (tgl > konfig.tanggalBuku) return false;
  const waktu = e.postedAt ?? e.createdAt;
  return new Date(waktu).getTime() <= konfig.cutoff.getTime();
}

const uang = (m) => toMoney(m).toFixed(2);

/**
 * Posisi tiap rekening kas/bank terhadap cutoff, dihitung LANGSUNG dari baris jurnal (status POSTED & REVERSED, sama seperti laporan).
 * `saldoCutoff` = saldo buku pada cutoff; `mutasiSesudah` = net movement sesudah cutoff; `saldoCurrent` = jumlah keduanya.
 */
export async function hitungPosisi(db, konfig = KALIBRASI_20260919) {
  const rekening = await db.finCashAccount.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, accountId: true }, orderBy: { name: "asc" } });
  const baris = await db.finJournalLine.findMany({
    where: { cashAccountId: { in: rekening.map((r) => r.id) }, entry: { status: { in: STATUS_DIHITUNG } } },
    select: {
      debit: true, credit: true, cashAccountId: true,
      entry: { select: { id: true, entryNumber: true, date: true, createdAt: true, postedAt: true, idempotencyKey: true, source: true, status: true, description: true } },
    },
  });
  const peta = new Map(rekening.map((r) => [r.id, { ...r, saldoCutoff: ZERO, mutasiSesudah: ZERO, barisSesudah: 0, entriSesudah: new Set() }]));
  const catatMundur = [];
  for (const l of baris) {
    const p = peta.get(l.cashAccountId);
    if (!p) continue;
    const net = toMoney(l.debit).minus(toMoney(l.credit));
    if (sebelumCutoff(l.entry, konfig)) p.saldoCutoff = p.saldoCutoff.plus(net);
    else {
      p.mutasiSesudah = p.mutasiSesudah.plus(net);
      p.barisSesudah += 1;
      p.entriSesudah.add(l.entry.id);
      // Bertanggal buku = tanggal cutoff, tetapi diposting SESUDAH cutoff → tidak bisa dibuktikan terjadi sebelum jam cutoff.
      if (tanggalIso(l.entry.date) === konfig.tanggalBuku) {
        catatMundur.push({ rekening: p.name, entryNumber: l.entry.entryNumber, status: l.entry.status, source: l.entry.source, dibuatPada: new Date(l.entry.postedAt ?? l.entry.createdAt).toISOString(), net: uang(net), keterangan: l.entry.description });
      }
    }
  }
  const hasil = [...peta.values()].map((p) => ({
    id: p.id, nama: p.name, kind: p.kind, accountId: p.accountId,
    saldoCutoff: uang(p.saldoCutoff), mutasiSesudah: uang(p.mutasiSesudah), saldoCurrent: uang(p.saldoCutoff.plus(p.mutasiSesudah)),
    jumlahBarisSesudah: p.barisSesudah, jumlahJurnalSesudah: p.entriSesudah.size,
  }));
  return { rekening: hasil, catatMundurTanggalCutoff: catatMundur };
}

/** Selisih (target − saldo buku pada cutoff) per rekening. Rekening target yang tidak ditemukan = galat keras (jangan menebak). */
export function hitungKoreksi(posisi, konfig = KALIBRASI_20260919) {
  const perNama = new Map(posisi.rekening.map((r) => [r.nama.trim().toUpperCase(), r]));
  const baris = Object.entries(konfig.target).map(([nama, target]) => {
    const r = perNama.get(nama.trim().toUpperCase());
    if (!r) throw Object.assign(new Error(`Rekening kas/bank "${nama}" tidak ditemukan. Ada: ${[...perNama.values()].map((x) => x.nama).join(", ")}`), { statusCode: 422 });
    const selisih = toMoney(target).minus(toMoney(r.saldoCutoff));
    return { rekeningId: r.id, accountId: r.accountId, nama: r.nama, saldoCutoff: r.saldoCutoff, target: uang(target), selisih: uang(selisih) };
  });
  const total = baris.reduce((s, b) => s.plus(toMoney(b.selisih)), ZERO);
  return { baris, total: uang(total) };
}

/** Akun ekuitas sistem "Koreksi Saldo Awal": pakai yang ada (systemKey → kode), buat bila belum ada. Idempoten. */
export async function pastikanAkunKoreksi(tx) {
  let akun = await tx.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KOREKSI_SALDO_AWAL } });
  if (!akun) {
    const induk = await tx.finAccount.findUnique({ where: { code: "3-0000" }, select: { id: true } });
    const sudahAda = await tx.finAccount.findUnique({ where: { code: AKUN_KOREKSI.code } });
    akun = sudahAda
      ? await tx.finAccount.update({ where: { id: sudahAda.id }, data: { systemKey: SYSTEM_KEYS.KOREKSI_SALDO_AWAL } })
      : await tx.finAccount.create({
        data: {
          code: AKUN_KOREKSI.code, name: AKUN_KOREKSI.name, type: "EKUITAS", normalBalance: "KREDIT", isPostable: true, active: true,
          systemKey: SYSTEM_KEYS.KOREKSI_SALDO_AWAL, parentId: induk?.id ?? null, description: AKUN_KOREKSI.description,
        },
      });
  }
  if (akun.type !== "EKUITAS") throw new Error(`Akun koreksi ${akun.code} bukan akun ekuitas (${akun.type}) — menolak memposting selisih ke sana.`);
  return akun;
}

/**
 * Posting kalibrasi — HARUS dipanggil dalam `prisma.$transaction`. Aman dipanggil berulang/paralel: kunci advisory menserialkan
 * proses, kunci idempotensi unik di DB menjamin SATU jurnal. Setelah posting, saldo pada cutoff diverifikasi ulang di dalam
 * transaksi yang sama; bila tidak persis sama dengan target, seluruh transaksi dibatalkan.
 */
export async function postKalibrasi(tx, { konfig = KALIBRASI_20260919, userId = null } = {}) {
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", konfig.idempotencyKey);

  const ada = await findEntryByKey(tx, konfig.idempotencyKey);
  if (ada) return { created: false, alasan: "sudah_diposting", entry: ada };

  const sebelum = await hitungPosisi(tx, konfig);
  const koreksi = hitungKoreksi(sebelum, konfig);
  const bergerak = koreksi.baris.filter((b) => !toMoney(b.selisih).isZero());
  if (bergerak.length === 0) return { created: false, alasan: "sudah_sesuai", sebelum, koreksi };

  const ekuitas = await pastikanAkunKoreksi(tx);
  const lines = [];
  for (const b of bergerak) {
    const s = toMoney(b.selisih);
    const nilai = s.abs();
    const naik = s.greaterThan(0); // saldo buku kurang dari saldo riil → kas/bank di-DEBIT
    lines.push({ accountId: b.accountId, cashAccountId: b.rekeningId, ...(naik ? { debit: nilai } : { credit: nilai }), description: `Kalibrasi saldo riil — ${b.nama} (buku ${b.saldoCutoff} → riil ${b.target})` });
    lines.push({ accountId: ekuitas.id, ...(naik ? { credit: nilai } : { debit: nilai }), description: `Koreksi saldo — ${b.nama}` });
  }

  const { entry, created } = await postJournal(tx, {
    date: konfig.tanggalBuku, description: konfig.keterangan, source: "SALDO_AWAL", idempotencyKey: konfig.idempotencyKey, userId, lines,
  });
  if (!created) return { created: false, alasan: "sudah_diposting", entry };

  const sesudah = await hitungPosisi(tx, konfig);
  for (const [nama, target] of Object.entries(konfig.target)) {
    const r = sesudah.rekening.find((x) => x.nama.trim().toUpperCase() === nama.trim().toUpperCase());
    if (!r || uang(r.saldoCutoff) !== uang(target)) throw new Error(`Verifikasi gagal: saldo ${nama} pada cutoff ${r?.saldoCutoff} ≠ target ${target}. Transaksi dibatalkan.`);
  }
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: entry.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: { aksi: "kalibrasi_saldo_riil", cutoff: konfig.kode, entryNumber: entry.entryNumber, totalSelisih: koreksi.total, rekening: koreksi.baris.map((b) => ({ nama: b.nama, buku: b.saldoCutoff, riil: b.target, selisih: b.selisih })) },
  });
  return { created: true, entry, sebelum, sesudah, koreksi };
}
