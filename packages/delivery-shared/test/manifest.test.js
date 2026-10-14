import test from "node:test";
import assert from "node:assert/strict";
import { teksBarisManifest, angkaManifest, labelUnitBaris, progresMuatServer, sumberManifest, ringkasManifestRute, manifestJob } from "../src/operasional/manifest.js";

const job = {
  id: "j1", type: "DELIVERY",
  manifest: {
    stop: 1, unit: 3, jenisProduk: 1, ringkas: "1 stop • 3 unit • 1 jenis produk",
    baris: [{ qty: 3, nama: "Kasur Sorong 3in1 Custom", ukuran: "100 × 200 cm", spesifikasi: "", unitLabel: ["U1", "U2", "U3"], unit: [] }],
    sumber: { penjual: "Kemal", label: "Penjualan Karyawan — dijual oleh Kemal", picLead: "Rifki" },
    muat: { dimuat: 2, total: 3, lengkap: false, label: "Barang dimuat 2/3 unit" },
  },
};

test("manifest: stop ≠ unit ≠ jenis produk; teks baris dan unit U1–U3", () => {
  assert.deepEqual(angkaManifest(job), { stop: 1, unit: 3, jenisProduk: 1 });
  assert.equal(teksBarisManifest(job.manifest.baris[0]), "3× Kasur Sorong 3in1 Custom — 100 × 200 cm");
  assert.equal(labelUnitBaris(job.manifest.baris[0]), "U1, U2, U3");
  assert.equal(angkaManifest({}), null);
  assert.equal(manifestJob(null), null);
});

test("progres muat, sumber (penjual vs PIC lead), dan ringkasan rute", () => {
  assert.deepEqual(progresMuatServer(job), { dimuat: 2, total: 3, lengkap: false, label: "Barang dimuat 2/3 unit" });
  assert.equal(progresMuatServer({ manifest: { muat: { total: 0 } } }), null);
  assert.deepEqual(sumberManifest(job), { label: "Penjualan Karyawan — dijual oleh Kemal", penjual: "Kemal", picLead: "Rifki" });
  assert.deepEqual(ringkasManifestRute([job, { type: "PICKUP", manifest: { unit: 1 } }, job]), { stop: 2, unit: 6 });
});
