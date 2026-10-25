import test from "node:test";
import assert from "node:assert/strict";
import { urutkan, tampilMetrik, selBiaya, penandaPerSumber, bannerUtama, statusMembayar, delta, deltaTeks, peringatanUrut, formatPersen } from "../src/features/laporan/akuisisiLogic.js";

const s = (id, o = {}) => ({ id, lead: 100, leadSah: 90, spam: 10, berOrder: 5, membayar: 2, lunas: 1, sampelKecil: false, konversiOrder: { nilai: 5.56, pembilang: 5, penyebut: 90 }, konversiLunas: { nilai: 1.11, pembilang: 1, penyebut: 90 }, ...o });

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
  assert.deepEqual(tampilMetrik(s("A"), "konversiOrder"), { utama: "5,56%", sub: "5 dari 90 lead sah", kosong: false });
  assert.equal(tampilMetrik(s("A", { konversiOrder: { nilai: null, pembilang: 0, penyebut: 0 } }), "konversiOrder").utama, "—");
  assert.equal(tampilMetrik(s("A"), "lead").sub, "90 sah · 10 spam"); assert.equal(tampilMetrik(s("A"), "berOrder").sub, "dari 90 lead sah");
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
