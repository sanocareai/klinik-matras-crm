import test from "node:test";
import assert from "node:assert/strict";
import { urutkan, tampilMetrik, selBiaya, penandaPerSumber, bannerUtama, statusMembayar, delta, deltaTeks, peringatanUrut, formatPersen, teksSorotan, teksPengecualian, teksPengecualianTotal, NOTA_AMBANG, METRIK_URUT } from "../src/features/laporan/akuisisiLogic.js";

const s = (id, o = {}) => ({ id, lead: 100, leadSah: 90, spam: 10, berOrder: 5, membayar: 2, lunas: 1, sampelKecil: false, sampelKecilNonSpam: false, konversiOrder: { nilai: 5, pembilang: 5, penyebut: 100, penyebutJenis: "TOTAL_LEAD_TERMASUK_SPAM" }, konversiOrderNonSpam: { nilai: 5.56, pembilang: 5, penyebut: 90, penyebutJenis: "LEAD_SAH_NON_SPAM" }, konversiLunas: { nilai: 1, pembilang: 1, penyebut: 100, penyebutJenis: "TOTAL_LEAD_TERMASUK_SPAM" }, konversiLunasNonSpam: { nilai: 1.11, pembilang: 1, penyebut: 90, penyebutJenis: "LEAD_SAH_NON_SPAM" }, ...o });

test("urutkan: metrik hitung menurun; seri → lead terbanyak; tidak mengubah array asal", () => {
  const a = [s("A", { berOrder: 3 }), s("B", { berOrder: 9 }), s("C", { berOrder: 9, lead: 500 })]; const salinan = [...a];
  assert.deepEqual(urutkan(a, "berOrder").map((x) => x.id), ["C", "B", "A"]); assert.deepEqual(a, salinan);
  assert.deepEqual(urutkan(a, "lead").map((x) => x.id), ["C", "A", "B"]);
});

test("urutkan rasio: sampel kecil dan nilai kosong SELALU di bawah sumber layak walau angkanya lebih tinggi; pemenang mengikuti data (tidak hardcode)", () => {
  const a = [s("KECIL", { sampelKecil: true, konversiOrder: { nilai: 26.67, pembilang: 4, penyebut: 15 } }), s("X", { konversiOrder: { nilai: 7.32, pembilang: 23, penyebut: 314 } }), s("Y", { konversiOrder: { nilai: 1.71, pembilang: 33, penyebut: 1929 } }), s("KOSONG", { konversiOrder: { nilai: null, pembilang: 0, penyebut: 0 }, leadSah: 0 })];
  assert.deepEqual(urutkan(a, "konversiOrder").map((x) => x.id), ["X", "Y", "KECIL", "KOSONG"]);
  const dibalik = a.map((x) => (x.id === "X" ? { ...x, konversiOrder: { nilai: 0.5, pembilang: 2, penyebut: 400 } } : x));
  assert.equal(urutkan(dibalik, "konversiOrder")[0].id, "Y");
});

test("tampilMetrik: denominator selalu terlihat; kosong → '—' (bukan 0%)", () => {
  assert.deepEqual(tampilMetrik(s("A"), "konversiOrder"), { utama: "5%", sub: "5 dari 100 total lead (termasuk spam)", kosong: false }, "konversi UTAMA = ÷ total lead termasuk spam");
  assert.deepEqual(tampilMetrik(s("A"), "konversiOrderNonSpam"), { utama: "5,56%", sub: "5 dari 90 lead sah (non-spam)", kosong: false }, "non-spam = metrik terpisah berlabel");
  assert.equal(tampilMetrik(s("A", { konversiOrder: { nilai: null, pembilang: 0, penyebut: 0, penyebutJenis: "TOTAL_LEAD_TERMASUK_SPAM" } }), "konversiOrder").utama, "—");
  assert.equal(tampilMetrik(s("A"), "lead").sub, "90 sah · 10 spam"); assert.equal(tampilMetrik(s("A"), "berOrder").sub, "dari 100 total lead (90 sah)");
  assert.equal(formatPersen(0), "0%");
});

test("selBiaya: null tetap '—' dengan alasan; nol sah ditampilkan Rp0; ROAS berformat ×", () => {
  assert.deepEqual(selBiaya({ cpa: null, alasanNull: { cpa: "SPEND_TIDAK_LENGKAP" } }, "cpa"), { teks: "—", alasan: "spend belum lengkap", kosong: true });
  assert.deepEqual(selBiaya({ cpa: 0, alasanNull: {} }, "cpa"), { teks: "Rp0", alasan: null, kosong: false });
  assert.equal(selBiaya({ cashRoas: 2.5 }, "cashRoas").teks, "2,50×");
  assert.equal(selBiaya({ status: "TIDAK_ADA_SUMBER_SPEND", cpa: null }, "cpa").alasan, "tanpa data spend");
  assert.equal(selBiaya(undefined, "cpa").teks, "—");
});

test("penandaPerSumber memetakan sorotan server; banner, urutan peringatan, dan status membayar", () => {
  const m = penandaPerSumber([{ id: "VOLUME", sumberId: "META" }, { id: "KONVERSI_ORDER", sumberId: "TIKTOK" }, { id: "ORDER_TERBANYAK", sumberId: "META" }]);
  assert.deepEqual(m.get("META").map((x) => x.id), ["VOLUME", "ORDER_TERBANYAK"]); assert.equal(m.get("TIKTOK").length, 1); assert.equal(m.get("WA"), undefined);
  assert.equal(bannerUtama({ peringatan: [{ kode: "SUMBER_LABEL_CRM" }, { kode: "SPEND_BELUM_LENGKAP" }] }), "Spend belum lengkap — CPA dan ROAS belum dapat dinilai.");
  assert.equal(bannerUtama({ peringatan: [{ kode: "SUMBER_LABEL_CRM" }] }), null);
  assert.deepEqual(peringatanUrut({ peringatan: [{ kode: "SUMBER_LABEL_CRM" }, { kode: "LEDGER_TIDAK_LENGKAP" }, { kode: "SPEND_BELUM_LENGKAP" }] }).map((w) => w.kode), ["SPEND_BELUM_LENGKAP", "LEDGER_TIDAK_LENGKAP", "SUMBER_LABEL_CRM"]);
  const kurang = { status: { ledger: { orderEligible: 10, orderBerLedger: 4, persen: 40 } } };
  assert.equal(statusMembayar(kurang).lengkap, false); assert.match(statusMembayar(kurang).teks, /ledger 4\/10/);
  assert.equal(statusMembayar({ status: { ledger: { orderEligible: 3, orderBerLedger: 3, persen: 100 } } }).lengkap, true);
});

test("delta pembanding: selisih absolut; tanpa pembanding/null → null", () => {
  const lap = { sumber: [{ id: "META", lead: 120 }], pembanding: { sumber: [{ id: "META", lead: 100 }] } };
  assert.equal(delta(lap, "META", "lead"), 20); assert.equal(deltaTeks(20), "+20"); assert.equal(deltaTeks(-3), "−3"); assert.equal(deltaTeks(0), "sama");
  assert.equal(delta({ sumber: [{ id: "META", lead: 1 }] }, "META", "lead"), null); assert.equal(deltaTeks(null), null);
});

test("metrik non-spam memakai ambang sampel non-spam sendiri; metrik utama memakai sampel total lead; daftar metrik memuat keduanya berlabel penyebut", () => {
  const a = [s("A", { sampelKecil: false, sampelKecilNonSpam: true, konversiOrderNonSpam: { nilai: 40, pembilang: 8, penyebut: 20, penyebutJenis: "LEAD_SAH_NON_SPAM" } }), s("B", { konversiOrderNonSpam: { nilai: 3, pembilang: 3, penyebut: 100, penyebutJenis: "LEAD_SAH_NON_SPAM" } })];
  assert.deepEqual(urutkan(a, "konversiOrderNonSpam").map((x) => x.id), ["B", "A"], "A: sampel non-spam kecil → di bawah walau 40%");
  assert.deepEqual(urutkan(a, "konversiOrder").map((x) => x.id), ["A", "B"], "pada konversi utama sampel A cukup (lead 100); seri → urut id");
  const label = METRIK_URUT.map((m) => m.label).join("|"); assert.match(label, /÷ total lead, termasuk spam/); assert.match(label, /non-spam \(÷ lead sah\)/);
});

test("teksSorotan: konversi menyebut nilai, pembilang, penyebut, jenis konversi, dan catatan ambang sementara (bukan signifikansi, bukan pemenang pasti); sorotan hitung = label saja", () => {
  const p = { id: "KONVERSI_ORDER", label: "Konversi ber-order tertinggi", jenis: "KONVERSI_BER_ORDER_PER_TOTAL_LEAD", jenisTeks: "customer ber-order ÷ total lead (termasuk spam)", nilai: 13.95, pembilang: 6, penyebut: 43, catatan: "hanya di antara sumber dengan ≥ 30 lead (aturan tampilan sementara; bukan uji signifikansi; bukan pemenang pasti)" };
  const t = teksSorotan(p); assert.match(t, /13,95%/); assert.match(t, /6 dari 43 total lead/); assert.match(t, /aturan tampilan sementara/); assert.match(t, /bukan pemenang pasti/);
  assert.equal(teksSorotan({ id: "VOLUME", label: "Volume lead terbesar", jenis: "hitung" }), "Volume lead terbesar"); assert.match(NOTA_AMBANG, /bukan uji signifikansi statistik/);
});

test("pengecualian ditampilkan eksplisit per sumber dan total (B2B/penjualan karyawan di luar semua sumber)", () => {
  assert.equal(teksPengecualian({ pengecualian: { spam: 10, internalStaff: 2, profilKaryawan: 1 } }), "Dikeluarkan dari lead sah: spam 10 · staf internal 2 · profil karyawan 1");
  const t = teksPengecualianTotal({ pengecualianTotal: { spam: 476, internalStaff: 0, profilKaryawan: 3, dikeluarkanDariSemuaSumber: { total: 3, perLabel: { B2B_DIRECT: 2, PENJUALAN_KARYAWAN: 1 } } } });
  assert.match(t, /spam 476/); assert.match(t, /profil karyawan 3/); assert.match(t, /B2B\/penjualan karyawan \(di luar semua sumber\) 3/); assert.match(t, /b2b direct 2/);
  assert.equal(teksPengecualian({}), null);
});
