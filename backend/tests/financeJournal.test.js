// Mesin jurnal — validasi & idempotensi.
//
// DUA LAPIS pengujian, sengaja dipisah:
//   - Fungsi MURNI (normalizeLines, toBookDate, todayBookDateWIB) dites
//     langsung tanpa apa pun.
//   - postJournal/reverseJournal dites dengan STUB tx (bukan Postgres).
//     Stub membuktikan LOGIKA-nya benar; pembuktian bahwa SQL & constraint-
//     nya benar ada di tests/integration/financeLedger.integration.test.js
//     terhadap Postgres sungguhan. Pelajaran ini mahal di repo ini — lihat
//     catatan `$1::uuid` di services/inventoryLedger.js: stub meloloskan
//     bug SQL yang membuat SELURUH endpoint gudang gagal pasca-deploy.

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLines, toBookDate, todayBookDateWIB, postJournal, reverseJournal,
  ensurePeriodOpen, generateDocumentNumber, JournalError,
} from "../src/services/finance/journal.js";

const AKUN_KAS = "akun-kas";
const AKUN_PENDAPATAN = "akun-pendapatan";
const AKUN_HEADER = "akun-header";
const AKUN_NONAKTIF = "akun-nonaktif";

// ── Stub tx minimal — cuma yang benar-benar disentuh postJournal ──────────
function bikinTx({ periode = null, entriBerdasarKey = new Map(), lemparP2002 = false } = {}) {
  const state = {
    entries: [],
    periodeDibuat: [],
    seq: 0,
  };
  const tx = {
    _state: state,
    orderSequence: {
      upsert: async () => ({ lastSeq: ++state.seq }),
    },
    finPeriod: {
      findUnique: async () => periode,
      create: async ({ data }) => {
        state.periodeDibuat.push(data);
        return { ...data, id: "p1" };
      },
    },
    finAccount: {
      findMany: async ({ where }) =>
        where.id.in.map((id) => ({
          id,
          code: id,
          name: id,
          isPostable: id !== AKUN_HEADER,
          active: id !== AKUN_NONAKTIF,
        })),
    },
    finJournalEntry: {
      findUnique: async ({ where }) => entriBerdasarKey.get(where.idempotencyKey) || null,
      create: async ({ data }) => {
        if (lemparP2002) {
          const e = new Error("unique");
          e.code = "P2002";
          e.meta = { target: ["idempotency_key"] };
          throw e;
        }
        const entry = { id: "e" + state.entries.length, ...data, lines: data.lines.create };
        state.entries.push(entry);
        return entry;
      },
      update: async ({ data }) => ({ ...data }),
    },
  };
  return tx;
}

const lineSeimbang = [
  { accountId: AKUN_KAS, debit: 100000 },
  { accountId: AKUN_PENDAPATAN, credit: 100000 },
];

// ─── Fungsi murni ─────────────────────────────────────────────────────────

test("normalizeLines: jurnal seimbang lolos & dinomori urut", () => {
  const { lines, total } = normalizeLines(lineSeimbang);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.lineNo), [1, 2]);
  assert.equal(total.toFixed(2), "100000.00");
});

test("normalizeLines: jurnal TIDAK seimbang ditolak, sekecil apa pun selisihnya", () => {
  // Satu sen pun tidak boleh lolos — ini jaminan 1 di kepala journal.js.
  assert.throws(
    () => normalizeLines([
      { accountId: AKUN_KAS, debit: "100000.01" },
      { accountId: AKUN_PENDAPATAN, credit: "100000.00" },
    ]),
    (err) => err instanceof JournalError && /tidak seimbang/i.test(err.message)
  );
});

test("normalizeLines: satu baris tidak boleh debit DAN kredit sekaligus", () => {
  assert.throws(
    () => normalizeLines([
      { accountId: AKUN_KAS, debit: 100, credit: 100 },
      { accountId: AKUN_PENDAPATAN, credit: 100 },
    ]),
    /hanya boleh debit ATAU kredit/i
  );
});

test("normalizeLines: baris kosong (debit 0 & kredit 0) ditolak", () => {
  assert.throws(
    () => normalizeLines([
      { accountId: AKUN_KAS, debit: 0, credit: 0 },
      { accountId: AKUN_PENDAPATAN, credit: 100 },
    ]),
    /isi salah satu kolom/i
  );
});

test("normalizeLines: nominal negatif ditolak, bukan diam-diam dibalik", () => {
  // Membalik diam-diam akan membuat arah transaksi berubah tanpa disadari
  // siapa pun yang menginput.
  assert.throws(
    () => normalizeLines([
      { accountId: AKUN_KAS, debit: -100 },
      { accountId: AKUN_PENDAPATAN, credit: -100 },
    ]),
    /tidak boleh negatif/i
  );
});

test("normalizeLines: jurnal bernilai nol ditolak", () => {
  assert.throws(() => normalizeLines([
    { accountId: AKUN_KAS, debit: "0.00", credit: "0" },
  ]), JournalError);
});

test("normalizeLines: minimal 2 baris", () => {
  assert.throws(() => normalizeLines([{ accountId: AKUN_KAS, debit: 100 }]), /minimal 2 baris/i);
});

test("toBookDate: string YYYY-MM-DD jadi tengah malam UTC, tanggal TIDAK bergeser", () => {
  // Kolom @db.Date. Kalau dibuat dengan new Date(y, m, d) di mesin
  // ber-timezone positif, tanggalnya mundur sehari saat disimpan.
  const d = toBookDate("2026-09-17");
  assert.equal(d.toISOString(), "2026-09-17T00:00:00.000Z");
});

test("toBookDate: menolak format asal-asalan", () => {
  assert.throws(() => toBookDate("17/09/2026"), JournalError);
  assert.throws(() => toBookDate(""), JournalError);
});

test("todayBookDateWIB: transaksi jam 01:00 WIB masuk tanggal HARI ITU, bukan kemarin", () => {
  // Server jalan UTC (docker-compose sengaja tanpa TZ). Jam 01:00 WIB
  // tanggal 18 = 18:00 UTC tanggal 17 — tanpa koreksi, tanggal bukunya
  // salah sehari, persis kelas bug yang dijaga utils/wib.js.
  const utc17Sore = new Date("2026-09-17T18:00:00.000Z");
  assert.equal(todayBookDateWIB(utc17Sore).toISOString(), "2026-09-18T00:00:00.000Z");

  const utc17Pagi = new Date("2026-09-17T02:00:00.000Z"); // 09:00 WIB
  assert.equal(todayBookDateWIB(utc17Pagi).toISOString(), "2026-09-17T00:00:00.000Z");
});

// ─── postJournal ──────────────────────────────────────────────────────────

test("postJournal: menolak prisma singleton (wajib tx)", async () => {
  await assert.rejects(
    () => postJournal({}, { date: "2026-09-17", description: "x", source: "MANUAL", lines: lineSeimbang }),
    /butuh `tx`/
  );
});

test("postJournal: jurnal normal tersimpan dengan nomor JV & status POSTED", async () => {
  const tx = bikinTx();
  const { entry, created } = await postJournal(tx, {
    date: "2026-09-17",
    description: "Setoran modal",
    source: "SALDO_AWAL",
    lines: lineSeimbang,
    userId: "u1",
  });
  assert.equal(created, true);
  assert.equal(entry.entryNumber, "JV-17092026-001");
  assert.equal(entry.status, "POSTED");
  assert.equal(entry.lines.length, 2);
  assert.equal(entry.postedById, "u1");
});

test("postJournal: IDEMPOTEN — kejadian yang sudah dibukukan tidak menghasilkan jurnal kedua", async () => {
  // Inti jaminan 2. Double-click/retry/replay job TIDAK boleh menggandakan
  // uang di buku besar.
  const sudahAda = { id: "e-lama", entryNumber: "JV-17092026-001", lines: [] };
  const tx = bikinTx({ entriBerdasarKey: new Map([["PEMBAYARAN_ORDER:p1", sudahAda]]) });

  const hasil = await postJournal(tx, {
    date: "2026-09-17",
    description: "Pembayaran order",
    source: "PEMBAYARAN_ORDER",
    sourceId: "p1",
    idempotencyKey: "PEMBAYARAN_ORDER:p1",
    lines: lineSeimbang,
  });
  assert.equal(hasil.created, false, "created=false — pemanggil TIDAK boleh menganggap ini kegagalan");
  assert.equal(hasil.entry.id, "e-lama");
  assert.equal(tx._state.entries.length, 0, "tidak ada jurnal baru yang ditulis");
});

test("postJournal: race yang kalah (P2002) memakai jurnal pemenang, bukan melempar error", async () => {
  // Cek findUnique di awal punya celah TOCTOU; constraint DB yang menutupnya.
  const pemenang = { id: "e-menang", lines: [] };
  const peta = new Map();
  const tx = bikinTx({ entriBerdasarKey: peta, lemparP2002: true });
  // Saat create gagal, kode membaca ulang — isi peta baru SETELAH cek awal.
  const findUniqueAsli = tx.finJournalEntry.findUnique;
  let panggilan = 0;
  tx.finJournalEntry.findUnique = async (args) => {
    panggilan++;
    if (panggilan === 1) return null; // cek awal: belum ada
    return pemenang; // setelah P2002: sudah ada
  };
  void findUniqueAsli;

  const hasil = await postJournal(tx, {
    date: "2026-09-17", description: "x", source: "PEMBAYARAN_ORDER",
    sourceId: "p1", idempotencyKey: "PEMBAYARAN_ORDER:p1", lines: lineSeimbang,
  });
  assert.equal(hasil.created, false);
  assert.equal(hasil.entry.id, "e-menang");
});

test("postJournal: akun HEADER ditolak — jurnal wajib menempel ke akun detail", async () => {
  const tx = bikinTx();
  await assert.rejects(
    () => postJournal(tx, {
      date: "2026-09-17", description: "x", source: "MANUAL",
      lines: [{ accountId: AKUN_HEADER, debit: 100 }, { accountId: AKUN_KAS, credit: 100 }],
    }),
    /akun kelompok \(header\)/i
  );
});

test("postJournal: akun NONAKTIF ditolak", async () => {
  const tx = bikinTx();
  await assert.rejects(
    () => postJournal(tx, {
      date: "2026-09-17", description: "x", source: "MANUAL",
      lines: [{ accountId: AKUN_NONAKTIF, debit: 100 }, { accountId: AKUN_KAS, credit: 100 }],
    }),
    /dinonaktifkan/i
  );
});

test("postJournal: periode TERTUTUP menolak jurnal baru", async () => {
  // Inilah yang membuat laporan bulan lalu tidak berubah diam-diam setelah
  // dilaporkan ke owner.
  const tx = bikinTx({ periode: { year: 2026, month: 8, status: "CLOSED" } });
  await assert.rejects(
    () => postJournal(tx, {
      date: "2026-08-31", description: "x", source: "MANUAL", lines: lineSeimbang,
    }),
    /sudah ditutup/i
  );
});

test("postJournal: periode baru dibuat otomatis berstatus OPEN", async () => {
  const tx = bikinTx({ periode: null });
  await postJournal(tx, { date: "2026-09-17", description: "x", source: "MANUAL", lines: lineSeimbang });
  assert.deepEqual(tx._state.periodeDibuat[0], { year: 2026, month: 9, status: "OPEN" });
});

test("ensurePeriodOpen: tanggal 1 tidak pernah jatuh ke bulan sebelumnya", async () => {
  // Kolom DATE dibaca Prisma sebagai instant UTC tengah malam. Memakai
  // getMonth() lokal akan menggeser tanggal 1 ke bulan sebelumnya di mesin
  // ber-offset negatif.
  const tx = bikinTx({ periode: null });
  await ensurePeriodOpen(tx, new Date("2026-09-01T00:00:00.000Z"));
  assert.deepEqual(tx._state.periodeDibuat[0], { year: 2026, month: 9, status: "OPEN" });
});

test("postJournal DRAFT: tidak menyentuh pemeriksaan periode", async () => {
  // Draft jurnal manual belum masuk buku besar, jadi periode tertutup pun
  // boleh menyimpan draft — yang ditolak nanti adalah saat POSTING-nya.
  const tx = bikinTx({ periode: { year: 2026, month: 9, status: "CLOSED" } });
  const { entry } = await postJournal(tx, {
    date: "2026-09-17", description: "draf", source: "MANUAL", lines: lineSeimbang, status: "DRAFT",
  });
  assert.equal(entry.status, "DRAFT");
  assert.equal(entry.postedAt, null);
});

test("generateDocumentNumber: nomor mengikuti TANGGAL BUKU, tidak bergeser oleh timezone mesin", async () => {
  // Tanggal buku 1 Oktober tersimpan sebagai 2026-10-01T00:00:00Z. Dibaca
  // dengan getter LOKAL di mesin ber-offset negatif, ia jadi 30 September —
  // nomornya memakai counter BULAN SEBELUMNYA dan bisa bentrok dengan
  // dokumen September yang sudah ada. Tes ini mengunci pemakaian getter UTC.
  // Dijalankan juga di bawah TZ=America/New_York (lihat script npm) supaya
  // pembuktiannya bukan cuma kebetulan mesin CI kebetulan UTC.
  const tx = bikinTx();
  const nomor = await generateDocumentNumber(tx, "EXP", toBookDate("2026-10-01"));
  assert.equal(nomor, "EXP-01102026-001");

  const tx2 = bikinTx();
  const awalTahun = await generateDocumentNumber(tx2, "JV", toBookDate("2026-01-01"));
  assert.equal(awalTahun, "JV-01012026-001");
});

// ─── reverseJournal ───────────────────────────────────────────────────────

function txDenganEntri(entry) {
  const tx = bikinTx();
  tx.finJournalEntry.findUnique = async ({ where }) => (where.id === entry.id ? entry : null);
  return tx;
}

const entriTerposting = {
  id: "e1",
  entryNumber: "JV-17092026-001",
  status: "POSTED",
  source: "PEMBAYARAN_ORDER",
  lines: [
    { accountId: AKUN_KAS, debit: "100000.00", credit: "0.00", description: "kas masuk", orderId: "o1", customerId: "c1", supplierId: null, cashAccountId: "ca1", unitId: null },
    { accountId: AKUN_PENDAPATAN, debit: "0.00", credit: "100000.00", description: null, orderId: "o1", customerId: "c1", supplierId: null, cashAccountId: null, unitId: null },
  ],
};

test("reverseJournal: debit/kredit ditukar dan DIMENSI dibawa apa adanya", async () => {
  // Dimensi ikut dibalik supaya saldo PER ORDER/PER CUSTOMER benar-benar
  // kembali nol — bukan cuma total per akun yang balance.
  const tx = txDenganEntri(entriTerposting);
  const rev = await reverseJournal(tx, { entryId: "e1", date: "2026-09-18", reason: "salah input", userId: "u9" });

  assert.equal(rev.source, "REVERSAL");
  assert.equal(rev.reversalOfId, "e1");
  assert.equal(rev.lines[0].debit, "0.00");
  assert.equal(rev.lines[0].credit, "100000.00");
  assert.equal(rev.lines[1].debit, "100000.00");
  assert.equal(rev.lines[0].orderId, "o1");
  assert.equal(rev.lines[0].cashAccountId, "ca1");
  assert.match(rev.description, /salah input/);
});

test("reverseJournal: alasan WAJIB", async () => {
  const tx = txDenganEntri(entriTerposting);
  await assert.rejects(() => reverseJournal(tx, { entryId: "e1", reason: "" }), /Alasan pembatalan wajib/i);
});

test("reverseJournal: jurnal yang sudah dibatalkan tidak bisa dibatalkan lagi", async () => {
  const tx = txDenganEntri({ ...entriTerposting, status: "REVERSED" });
  await assert.rejects(() => reverseJournal(tx, { entryId: "e1", reason: "x" }), /sudah pernah dibatalkan/i);
});

test("reverseJournal: DRAFT tidak dibalik — dihapus saja", async () => {
  const tx = txDenganEntri({ ...entriTerposting, status: "DRAFT" });
  await assert.rejects(() => reverseJournal(tx, { entryId: "e1", reason: "x" }), /masih draft/i);
});

test("reverseJournal: jurnal balik tidak boleh dibalik lagi", async () => {
  const tx = txDenganEntri({ ...entriTerposting, source: "REVERSAL" });
  await assert.rejects(() => reverseJournal(tx, { entryId: "e1", reason: "x" }), /jurnal balik/i);
});

test("reverseJournal: tanpa tanggal eksplisit memakai HARI INI (WIB), bukan tanggal jurnal asli", async () => {
  // Supaya koreksi muncul di periode saat koreksi diputuskan, tidak
  // menyelinap ke periode yang sudah dilaporkan ke owner.
  const tx = txDenganEntri(entriTerposting);
  const rev = await reverseJournal(tx, { entryId: "e1", reason: "koreksi" });
  const hariIni = todayBookDateWIB();
  assert.equal(rev.date.toISOString(), hariIni.toISOString());
});
