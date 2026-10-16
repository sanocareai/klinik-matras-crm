// FIXTURE VERIFIKASI atribusi iklan (BUKAN daftar iklan permanen): 6 pemetaan Ad → Ad Set → Campaign yang diverifikasi Mesa dari data akun Meta
// (sourceID capture CTWA = Ad ID, 6 dari 6). Nama hanya label (hanya yang diberikan; sisanya null). Iklan baru dipetakan lewat impor referensi,
// tanpa perubahan kode. Ads Manager mengekspor ID sebagai teks — di CSV di bawah ID diberi kutip agar tidak berubah menjadi notasi ilmiah.
export const ENAM_PEMETAAN = Object.freeze([
  { adId: "52694481763484", adSetId: "52694481763284", campaignId: "52694481763084", campaignName: "Jabo IG Oktober", adName: "Teardown Untuk Ibu" },
  { adId: "52689767293284", adSetId: "52689767293084", campaignId: "52689735916884", campaignName: "IG gabungan lama", adName: "Teardown 20jt" },
  { adId: "52696131903684", adSetId: "52696131903484", campaignId: "52696131903884", campaignName: "FB broad test", adName: null },
  { adId: "52696128519084", adSetId: "52696128519284", campaignId: "52696128518884", campaignName: "Promo 10.10", adName: null },
  { adId: "52694489680084", adSetId: "52694489680284", campaignId: "52694489679884", campaignName: "RTG IG", adName: null },
  { adId: "52694485574084", adSetId: "52694481763284", campaignId: "52694481763084", campaignName: "Jabo IG Oktober", adName: "Teardown 20JT" },
]);

const q = (v) => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`);

/** CSV gaya ekspor Ads Manager (kolom Inggris). */
export function csvAdsManager(rows = ENAM_PEMETAAN, { pemisah = ",", bom = false } = {}) {
  const kolom = ["Campaign name", "Campaign ID", "Ad set ID", "Ad ID", "Ad name"];
  const baris = rows.map((r) => [q(r.campaignName), q(r.campaignId), q(r.adSetId), q(r.adId), q(r.adName)].join(pemisah));
  return (bom ? "﻿" : "") + [kolom.map((k) => `"${k}"`).join(pemisah), ...baris].join("\n");
}

/** Bentuk `rows` JSON (tanpa CSV). */
export const barisJson = (rows = ENAM_PEMETAAN) => rows.map((r, i) => ({ baris: i + 2, ...r }));
