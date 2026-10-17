// KOREKSI PER DOKUMEN (UI) — logika murni: bukti → dasar tanggal bawaan, validasi sebelum tombol aktif, tidak menebak harga/tanggal, penjagaan sumber (tanpa tombol massal).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dasarBawaan, tanggalDariDasar, susunBodyAkui, susunBodyHarga, susunBodyAtribusi, ringkasDampak, pilihanTanggalTersedia } from "../src/features/finance/koreksiDokumen/logic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (rel) => fs.readFileSync(path.join(akar, rel), "utf8");
const det = (o = {}) => ({
  tahan: [], praCutoff: false, items: [{ id: "i1", nama: "Paket", harga: 0 }],
  pilihanTanggal: [
    { dasar: "TANGGAL_SERAH_POD", tanggal: "2026-10-06", tersedia: true }, { dasar: "TANGGAL_STATUS_DISERAHKAN", tanggal: "2026-10-07", tersedia: true },
    { dasar: "KEPUTUSAN_OWNER", tanggal: null, tersedia: true },
  ], ...o,
});

test("dasar bawaan: POD → riwayat status → kosong (tidak pernah menebak tanggal hari ini)", () => {
  assert.equal(dasarBawaan(det()), "TANGGAL_SERAH_POD");
  assert.equal(dasarBawaan(det({ pilihanTanggal: [{ dasar: "TANGGAL_SERAH_POD", tanggal: null, tersedia: false }, { dasar: "TANGGAL_STATUS_DISERAHKAN", tanggal: "2026-10-07", tersedia: true }] })), "TANGGAL_STATUS_DISERAHKAN");
  assert.equal(dasarBawaan(det({ pilihanTanggal: [{ dasar: "KEPUTUSAN_OWNER", tanggal: null, tersedia: true }] })), "");
  assert.equal(tanggalDariDasar(det(), "TANGGAL_SERAH_POD"), "2026-10-06");
  assert.equal(tanggalDariDasar(det(), "KEPUTUSAN_OWNER"), "", "Keputusan Owner: tanggal diisi manusia");
  assert.equal(pilihanTanggalTersedia(det()).length, 3);
});

test("tombol akui: butuh dasar, tanggal, alasan ≥10, bukti referensi untuk Keputusan Owner, persetujuan pra-cutoff; order ditahan keras tidak bisa", () => {
  const ok = { dasarTanggal: "TANGGAL_SERAH_POD", tanggal: "2026-10-06", alasan: "bukti POD terverifikasi" };
  assert.equal(susunBodyAkui(det(), ok).galat, null);
  assert.ok(susunBodyAkui(det(), { ...ok, dasarTanggal: "" }).galat);
  assert.ok(susunBodyAkui(det(), { ...ok, alasan: "pendek" }).galat);
  assert.ok(susunBodyAkui(det(), { ...ok, tanggal: "" }).galat);
  const owner = { dasarTanggal: "KEPUTUSAN_OWNER", tanggal: "2026-10-10", alasan: "diputuskan Owner via WA" };
  assert.ok(susunBodyAkui(det(), owner).galat, "tanpa bukti referensi");
  const b = susunBodyAkui(det(), { ...owner, buktiReferensi: "Pesan WA Owner 16 Okt" });
  assert.equal(b.galat, null); assert.equal(b.body.buktiReferensi, "Pesan WA Owner 16 Okt");
  assert.ok(!("buktiReferensi" in susunBodyAkui(det(), ok).body));
  assert.ok(susunBodyAkui(det({ praCutoff: true }), { ...owner, buktiReferensi: "Pesan WA Owner 16 Okt" }).galat, "pra-cutoff butuh centang");
  assert.equal(susunBodyAkui(det({ praCutoff: true }), { ...owner, buktiReferensi: "Pesan WA Owner 16 Okt", akuiPraCutoff: true }).body.akuiPraCutoff, true);
  assert.ok(susunBodyAkui(det({ tahan: [{ kode: "LUNAS_TANPA_PEMBAYARAN", pesan: "Lunas tanpa pembayaran" }] }), ok).galat.includes("Lunas"));
  assert.equal(susunBodyAkui(det({ tahan: [{ kode: "DISERAHKAN_SEBELUM_CUTOFF", pesan: "x", lunakDenganPersetujuan: true }] }), ok).galat, null);
});

test("harga: hanya dari isian manusia pada item Rp0; tanpa isian/bukti → tombol nonaktif; harga katalog TIDAK dipakai otomatis", () => {
  const d = det({ items: [{ id: "i1", nama: "A", harga: 0, hargaKatalog: 1900000 }, { id: "i2", nama: "B", harga: 500000 }] });
  assert.ok(susunBodyHarga(d, {}, { buktiHarga: "Penawaran PN-0912", alasan: "harga dari penawaran" }).galat);
  const r = susunBodyHarga(d, { i1: "850000", i2: "1" }, { buktiHarga: "Penawaran PN-0912", alasan: "harga dari penawaran" });
  assert.equal(r.galat, null); assert.deepEqual(r.body.harga, [{ itemId: "i1", harga: 850000 }], "item berharga tidak ikut; katalog tidak dipakai");
  assert.ok(susunBodyHarga(d, { i1: "850000" }, { buktiHarga: "", alasan: "harga dari penawaran" }).galat);
  assert.ok(susunBodyHarga(d, { i1: "850000.5" }, { buktiHarga: "Penawaran PN-0912", alasan: "harga dari penawaran" }).galat);
  assert.ok(susunBodyHarga(det({ items: [{ id: "i2", nama: "B", harga: 500000 }] }), {}, { buktiHarga: "Penawaran PN-0912", alasan: "harga dari penawaran" }).galat.includes("Rp0"));
});

test("atribusi: pilih divisi + alasan ≥10; dampak diringkas dari angka server", () => {
  assert.ok(susunBodyAtribusi("", "BBM dipakai armada Delivery").galat);
  assert.ok(susunBodyAtribusi("DELIVERY", "pendek").galat);
  assert.equal(susunBodyAtribusi("DELIVERY", "BBM dipakai armada Delivery").galat, null);
  assert.deepEqual(ringkasDampak({ pendapatanBertambah: 1500000, piutangUsahaBerubah: 0, uangMukaPelangganBerubah: -1500000 }), ["Pendapatan bertambah Rp1.500.000", "Uang muka pelanggan berkurang Rp1.500.000"]);
});

test("sumber: tidak ada tombol/aksi massal; menulis lewat PIN + Idempotency-Key; pratinjau sebelum simpan", () => {
  const src = baca("src/features/finance/koreksiDokumen/KoreksiDokumen.jsx");
  const penulis = src.split(/\r?\n/).filter((b) => b.includes("api.kirim"));
  assert.ok(penulis.length >= 5 && penulis.every((b) => !b.includes(".map(") && !b.includes("forEach") && !b.includes("Promise.all")), "satu dokumen per panggilan, tanpa perulangan penulisan");
  assert.ok(src.includes("usePinStepUp") && src.includes("kunciBaruKoreksi"));
  assert.ok(src.includes("preview: true"));
  const api = baca("src/api.js");
  assert.ok(api.includes("kirimKoreksiPengakuan") && api.includes("kirimKeputusanAtribusi"));
});

test("pengakuan yang sudah dibalik: tombol akui butuh persetujuan eksplisit (akuiSetelahDibalik) dan mengirimnya", () => {
  const d = det({ tahan: [{ kode: "PENGAKUAN_DIBALIK_SENGAJA", pesan: "dibalik", lunakDenganPersetujuan: true }] });
  const f = { dasarTanggal: "TANGGAL_SERAH_POD", tanggal: "2026-10-06", alasan: "bukti POD terverifikasi" };
  assert.ok(susunBodyAkui(d, f).galat.includes("dibalik"));
  const ok = susunBodyAkui(d, { ...f, akuiSetelahDibalik: true });
  assert.equal(ok.galat, null); assert.equal(ok.body.akuiSetelahDibalik, true);
  assert.ok(!("akuiSetelahDibalik" in susunBodyAkui(det(), f).body));
});
