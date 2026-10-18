// MANIFEST BARANG DELIVERY — domain murni (tanpa DB). Kasus acuan: PKR Indra (U1/U2/U3 identik) yang sebelumnya terbaca "Kasur • 100 × 200 cm" (seolah satu kasur).
import test from "node:test";
import assert from "node:assert/strict";
import { bangunManifest, teksManifest, teksBarisManifest, teksSelManifest, labelUnit } from "../src/lib/domain/deliveryManifest.js";

const ALAT = { ukuranDariNotes: (n) => { try { const p = JSON.parse(n); return { ukuranKasur: p.ukuranKasur || "", merkKasur: p.merkKasur || "" }; } catch { return { ukuranKasur: "", merkKasur: "" }; } } };
const unit = (seq, extra = {}) => ({ id: `u${seq}`, unitCode: `NEW-11102026-023-U${seq}`, seq, status: "READY_FOR_DELIVERY", merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", ...extra });
const ju = (u) => ({ unit: u });
const ORDER_PKR = { id: "o1", notes: JSON.stringify({ merkKasur: "Kasur Sorong 3in1 custom", ukuranKasur: "100 × 200 cm" }), penjualanKaryawan: { nomor: "PKR-11102026-005", seller: { name: "Kemal" } }, units: [] };
const job = (units, order = ORDER_PKR, extra = {}) => ({ id: "j1", type: "DELIVERY", status: "SCHEDULED", order, units: units.map(ju), ...extra });
const item = (o) => ({ seq: 1, categoryName: "Kasur Baru", shape: "KASUR", workKind: "BARU", productName: null, qty: 1, specNotes: null, lengthCm: null, widthCm: null, thicknessCm: null, heightCm: null, bundleNo: null, bundleName: null, componentSeq: null, ...o });

test("Indra: 1 stop • 3 unit • 1 jenis produk; baris '3× …'; unit U1,U2,U3; sumber PKR dijual oleh Kemal", () => {
  const m = bangunManifest(job([unit(1), unit(2), unit(3)]), ALAT);
  assert.equal(m.stop, 1);
  assert.equal(m.unit, 3);
  assert.equal(m.jenisProduk, 1);
  assert.equal(m.ringkas, "1 stop • 3 unit • 1 jenis produk");
  assert.equal(m.baris.length, 1);
  assert.equal(m.baris[0].qty, 3);
  assert.deepEqual(m.baris[0].unitLabel, ["U1", "U2", "U3"]);
  assert.equal(teksBarisManifest(m.baris[0]), "3× Kasur Sorong 3in1 custom — 100 × 200 cm");
  assert.equal(m.sumber.label, "Penjualan Karyawan — dijual oleh Kemal");
  assert.deepEqual(teksManifest(m), ["1 stop • 3 unit • 1 jenis produk", "3× Kasur Sorong 3in1 custom — 100 × 200 cm", "Unit: U1, U2, U3", "Sumber: Penjualan Karyawan — dijual oleh Kemal"]);
});

test("produk identik digabung tetapi detail unit tetap tersedia (id, kode, status per unit)", () => {
  const m = bangunManifest(job([unit(1), unit(2), unit(3)]), ALAT);
  assert.equal(m.baris[0].unit.length, 3);
  assert.deepEqual(m.baris[0].unit.map((u) => u.kode), ["NEW-11102026-023-U1", "NEW-11102026-023-U2", "NEW-11102026-023-U3"]);
  assert.ok(m.baris[0].unit.every((u) => u.id && u.status));
});

test("produk campuran: baris terpisah, total unit benar (2 kasur + 1 divan)", () => {
  const k = (s) => unit(s, { pkrItemUnit: { item: item({ productName: "Kasur Sano", lengthCm: 200, widthCm: 160, thicknessCm: 20 }) } });
  const d = unit(3, { merk: "Divan Laci", pkrItemUnit: { item: item({ seq: 2, categoryName: "Divan/Box", shape: "DIVAN", productName: "Divan Laci", lengthCm: 200, widthCm: 160, heightCm: 30 }) } });
  const m = bangunManifest(job([k(1), k(2), d]), ALAT);
  assert.equal(m.unit, 3);
  assert.equal(m.jenisProduk, 2);
  assert.equal(m.ringkas, "1 stop • 3 unit • 2 jenis produk");
  assert.deepEqual(m.baris.map((b) => [b.qty, b.nama]), [[2, "Kasur Sano"], [1, "Divan Laci"]]);
  assert.match(m.baris[0].ukuran, /200 × 160 × 20 cm/);
});

test("bundel/set tampil sebagai komponen fisik (Kasur, Divan, Sandaran), bukan satu baris 'Set'", () => {
  const komp = (s, nama, shape, productName) => unit(s, { pkrItemUnit: { item: item({ seq: s, categoryName: nama, shape, productName, bundleNo: 1, bundleName: "Set Sano Premium", lengthCm: 200, widthCm: 160 }) } });
  const m = bangunManifest(job([komp(1, "Kasur", "KASUR", "Sano Sehat"), komp(2, "Divan", "DIVAN", "Divan Laci"), komp(3, "Sandaran", "SANDARAN", "Headboard Minimal")]), ALAT);
  assert.equal(m.unit, 3);
  assert.equal(m.jenisProduk, 3);
  assert.deepEqual(m.baris.map((b) => b.bundel?.nama), ["Set Sano Premium", "Set Sano Premium", "Set Sano Premium"]);
  assert.deepEqual(m.baris.map((b) => b.nama), ["Kasur Sano Sehat", "Divan Divan Laci", "Sandaran Headboard Minimal"]);
  const t = teksManifest(m);
  assert.ok(t.includes("Set Set Sano Premium:"));
});

test("service: nama layanan + unit customer yang dibawa; unit CANCELLED tidak ikut", () => {
  const s1 = unit(1, { pkrItemUnit: { item: item({ categoryName: "Service/Upgrade Kasur", shape: "SERVICE", workKind: "LAYANAN", productName: "Upgrade Lapisan Matras Sehat", lengthCm: 200, widthCm: 160 }) } });
  const batal = unit(2, { status: "CANCELLED" });
  const m = bangunManifest(job([s1, batal]), ALAT);
  assert.equal(m.unit, 1);
  assert.equal(m.baris[0].nama, "Upgrade Lapisan Matras Sehat");
  assert.equal(m.baris[0].jenisKerja, "LAYANAN");
});

test("order lama diadopsi ('Pesanan awal') memakai ukuran order, bukan dimensi kosong; spesifikasi adopsi tidak ditampilkan", () => {
  const a = (s) => unit(s, { ukuran: null, pkrItemUnit: { item: item({ categoryName: "Pesanan awal (order lama)", shape: "CUSTOM", productName: "Kasur Sorong 3in1 custom", specNotes: "Pesanan awal (order lama) · ukuran 100 x 200" }) } });
  const m = bangunManifest(job([a(1), a(2), a(3)]), ALAT);
  assert.equal(m.baris.length, 1);
  assert.equal(m.baris[0].ukuran, "100 × 200 cm");
  assert.equal(m.baris[0].spesifikasi, "");
});

test("tanpa harga/nilai/pembayaran: manifest tidak memuat kunci uang apa pun", () => {
  const m = bangunManifest(job([unit(1), unit(2)], { ...ORDER_PKR, value: 7200000, payments: [{ amount: 1000 }] }), ALAT);
  const json = JSON.stringify(m);
  assert.doesNotMatch(json, /harga|price|nominal|amount|"value"|payment|piutang|subtotal|rupiah/i);
  assert.doesNotMatch(json, /7200000|1000/, "nilai order tidak bocor");
});

test("order non-PKR: cadangan memakai data unit; tanpa sumber PKR; label unit dari kode", () => {
  const order = { id: "o2", notes: JSON.stringify({ merkKasur: "King Koil", ukuranKasur: "160 × 200 cm" }), units: [] };
  const u = (s) => ({ id: `x${s}`, unitCode: `RES-01092026-001-U${s}`, seq: s, status: "RECEIVED", merk: "King Koil", ukuran: "160x200" });
  const m = bangunManifest({ id: "j2", type: "PICKUP", status: "SCHEDULED", order, units: [ju(u(1))] }, ALAT);
  assert.equal(m.unit, 1);
  assert.equal(m.sumber, null);
  assert.equal(labelUnit(u(1)), "U1");
  assert.equal(teksSelManifest(m), "1× King Koil — 160 × 200 cm (U1)");
});

// Bug nyata 18 Okt 2026 (laporan owner, order SOFA & LAYANAN RES-18102026-088
// "Mita"): unit restorasi sofa tanpa merk/item PKR menampilkan "1× Kasur" ke
// driver padahal ordernya restorasi sofa (ganti kain/busa/rangka) — fallback
// lama buta terhadap Order.productLine, jatuh langsung ke "Kasur" literal.
test("order non-PKR lini SOFA tanpa merk unit: cadangan memakai productType order ('Sofa 2 Seater', LEBIH spesifik dari lini), BUKAN 'Kasur'", () => {
  const order = { id: "o3", category: "LAYANAN", productLine: "SOFA", productType: "SOFA_2_SEATER", notes: null, units: [] };
  const u = { id: "y1", unitCode: "RES-18102026-088-U1", seq: 1, status: "ASSIGNED", merk: "", ukuran: "" };
  const m = bangunManifest({ id: "j3", type: "PICKUP", status: "SCHEDULED", order, units: [ju(u)] }, ALAT);
  assert.equal(m.unit, 1);
  assert.equal(m.baris[0].nama, "Sofa 2 Seater");
  assert.equal(teksBarisManifest(m.baris[0]), "1× Sofa 2 Seater");
});

test("order non-PKR: productType tidak dikenal/kosong -> cadangan turun ke productLine order ('Sofa')", () => {
  const order = { id: "o3b", category: "LAYANAN", productLine: "SOFA", productType: null, notes: null, units: [] };
  const u = { id: "y1b", unitCode: "RES-18102026-089-U1", seq: 1, status: "ASSIGNED", merk: "", ukuran: "" };
  const m = bangunManifest({ id: "j3b", type: "PICKUP", status: "SCHEDULED", order, units: [ju(u)] }, ALAT);
  assert.equal(m.baris[0].nama, "Sofa");
});

// Bug nyata 18 Okt 2026 (laporan owner, order RES-14102026-076 "Suyunni"):
// sales memilih merk "Lainnya" (brand tidak ada di daftar, TANPA field teks
// bebas pendamping) — unit.merk DAN notes.merkKasur keduanya literal
// "Lainnya". Driver melihat "1× Lainnya" telanjang, tidak memberi tahu
// barang apa yang sebenarnya dibawa (seharusnya "Kasur Spring").
test("order non-PKR: merk unit literal 'Lainnya' (placeholder, bukan nama produk) -> cadangan memakai productType, bukan kata 'Lainnya' itu sendiri", () => {
  const order = { id: "o5", category: "LAYANAN", productLine: "KASUR", productType: "KASUR_SPRING", notes: JSON.stringify({ merkKasur: "Lainnya", ukuranKasur: "200 × 200 cm (King Besar)" }), units: [] };
  const u = { id: "w1", unitCode: "RES-14102026-076-U1", seq: 1, status: "ASSIGNED", merk: "Lainnya", ukuran: "200x200 cm (King Besar)" };
  const m = bangunManifest({ id: "j5", type: "DELIVERY", status: "SCHEDULED", order, units: [ju(u)] }, ALAT);
  assert.equal(m.baris[0].nama, "Kasur Spring");
  assert.equal(teksBarisManifest(m.baris[0]), "1× Kasur Spring — 200 × 200 cm (King Besar)");
});

test("order non-PKR: merk unit sungguhan (bukan 'Lainnya') tetap dipakai apa adanya — penyaringan placeholder tidak melebar ke merk nyata", () => {
  const order = { id: "o6", category: "LAYANAN", productLine: "KASUR", productType: "KASUR_SPRING", notes: null, units: [] };
  const u = { id: "v1", unitCode: "RES-01102026-050-U1", seq: 1, status: "ASSIGNED", merk: "King Koil", ukuran: "160x200" };
  const m = bangunManifest({ id: "j6", type: "DELIVERY", status: "SCHEDULED", order, units: [ju(u)] }, ALAT);
  assert.equal(m.baris[0].nama, "King Koil");
});

test("order non-PKR lini DIVAN tanpa merk unit: cadangan memakai productLine order ('Divan')", () => {
  const order = { id: "o4", category: "BARU", productLine: "DIVAN", notes: null, units: [] };
  const u = { id: "z1", unitCode: "RES-19102026-001-U1", seq: 1, status: "ASSIGNED", merk: "", ukuran: "" };
  const m = bangunManifest({ id: "j4", type: "DELIVERY", status: "SCHEDULED", order, units: [ju(u)] }, ALAT);
  assert.equal(m.baris[0].nama, "Divan");
});

test("progres muat 'Barang dimuat x/y unit' dari unitLoads; replay data sama tidak menambah hitungan", () => {
  const j = job([unit(1), unit(2), unit(3)], ORDER_PKR, { unitLoads: [{ unitId: "u1" }, { unitId: "u2" }] });
  const m = bangunManifest(j, ALAT);
  assert.deepEqual(m.muat, { dimuat: 2, total: 3, lengkap: false, label: "Barang dimuat 2/3 unit" });
  assert.equal(m.baris[0].unit.filter((u) => u.dimuat).length, 2);
  const lengkap = bangunManifest({ ...j, unitLoads: [{ unitId: "u1" }, { unitId: "u2" }, { unitId: "u3" }, { unitId: "u3" }] }, ALAT);
  assert.equal(lengkap.muat.label, "Barang dimuat 3/3 unit");
  assert.equal(lengkap.muat.lengkap, true);
});

test("tambahan pesanan yang belum masuk job terdeteksi sebagai sinyal (job belum berjalan), bukan disisipkan diam-diam", () => {
  const order = { ...ORDER_PKR, units: [unit(1), unit(2), unit(3), unit(4, { status: "RECEIVED", jobUnits: [] })].map((u) => ({ ...u, jobUnits: u.seq <= 3 ? [{ job: { id: "j1", type: "DELIVERY" } }] : [] })) };
  const m = bangunManifest(job([unit(1), unit(2), unit(3)], order), ALAT);
  assert.equal(m.unit, 3);
  assert.deepEqual(m.tambahanBelumMasuk.map((x) => x.label), ["U4"]);
  const berjalan = bangunManifest(job([unit(1), unit(2), unit(3)], order, { status: "EN_ROUTE" }), ALAT);
  assert.deepEqual(berjalan.tambahanBelumMasuk, [], "rute berjalan: tidak ada sinyal penyisipan");
});
