// Nilai persediaan — logika MURNI (tanpa DB): klasifikasi baris & cakupan. Aturan inti: pengecualian TIDAK PERNAH bernilai Rp0; nol sah dipisah; cakupan satu sumber.
import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiBaris, ringkasCakupan, urutkanRisiko, hitungEstimasi, peranPelihatNominal, statusHasilSO, labelNolTerverifikasi, STATUS, STATUS_PENGECUALIAN } from "../src/services/nilaiPersediaan.js";

const bahan = (o = {}) => ({ id: "m1", code: "BHN-1", name: "Bahan Uji", unit: "KG", category: "RAW_MATERIAL", active: true, ...o });
const harga = (o = {}) => ({ harga: 5000, satuan: "KG", berlakuMulai: new Date("2026-10-01T00:00:00Z"), sumber: "MANUAL", label: "BELUM_DIDUKUNG_BUKTI", ...o });
const SO = (o = {}) => ({ id: "so1", jenis: "PENGAMATAN_SATUAN", jumlah: 13.5, satuan: "ROLL", soTanggal: "2026-11-04", soWaktu: null, sumber: "KIRIM GILANG.xlsx O4", alasan: "Hasil SO dalam ROLL", pelaku: { nama: "Gilang" }, revisi: 1, ...o });
const K = (o) => klasifikasiBaris({ bahan: bahan(), saldo: 10, jumlahPergerakan: 2, harga: harga(), ...o });

test("N1. dinilai = saldo × harga; satuan sama tidak peduli huruf besar/kecil", () => {
  const b = K({}); assert.equal(b.status, STATUS.DINILAI); assert.equal(b.nilai, 50000);
  assert.equal(K({ harga: harga({ satuan: "kg" }) }).status, STATUS.DINILAI);
  assert.equal(K({ saldo: 2.5, harga: harga({ harga: 3333.3333 }) }).nilai, 8333.3333);
});
test("N2. pengecualian TIDAK pernah bernilai Rp0 (nilai null) dan tidak hilang dari cakupan", () => {
  const kasus = [K({ jumlahPergerakan: 0, saldo: 0 }), K({ saldo: -3 }), K({ harga: null }), K({ harga: harga({ satuan: "ROLL" }) }), K({ hasilSO: SO() })];
  assert.deepEqual(kasus.map((b) => b.status), [STATUS.STOK_BELUM_DIKETAHUI, STATUS.SALDO_MINUS, STATUS.HARGA_KOSONG, STATUS.SATUAN_TIDAK_COCOK, STATUS.PENGAMATAN_FISIK]);
  for (const b of kasus) { assert.equal(b.nilai, null, b.status); assert.ok(STATUS_PENGECUALIAN.includes(b.status)); assert.ok(b.keterangan.length > 5); }
  const c = ringkasCakupan(kasus); assert.equal(c.pengecualian, 5); assert.equal(c.relevan, 5); assert.equal(c.dinilai, 0); assert.equal(c.persenDinilai, 0);
});
test("N3. belum ada catatan ≠ nol; nol menurut pergerakan = saldo nol sah (Rp0 benar) dan bukan pengecualian", () => {
  const belum = K({ jumlahPergerakan: 0, saldo: 0 }); assert.equal(belum.saldo, null, "saldo belum diketahui ditampilkan null, bukan 0"); assert.equal(belum.status, STATUS.STOK_BELUM_DIKETAHUI);
  const nol = K({ saldo: 0, jumlahPergerakan: 3 }); assert.equal(nol.status, STATUS.SALDO_NOL); assert.equal(nol.nilai, 0);
  const ver = K({ saldo: 0, jumlahPergerakan: 0, nolTerverifikasi: true }); assert.equal(ver.status, STATUS.SALDO_NOL);
  const c = ringkasCakupan([belum, nol, ver]); assert.equal(c.saldoNol, 2); assert.equal(c.pengecualian, 1); assert.equal(c.relevan, 1);
});
test("N4. terukur dalam satuan lain (ROLL): saldo sistem tampil, TIDAK dinilai dari pengamatan, tidak dikonversi; keterangan menyebut ROLL terukur dan METER belum terukur", () => {
  const b = K({ saldo: 122, bahan: bahan({ unit: "METER" }), harga: harga({ satuan: "METER", harga: 35500 }), hasilSO: SO({ jumlah: 1, satuan: "ROLL" }) });
  assert.equal(b.status, STATUS.PENGAMATAN_FISIK); assert.equal(b.nilai, null); assert.equal(b.saldo, 122, "saldo sistem tampil apa adanya"); assert.equal(b.hasilSOBermasalah, true);
  assert.match(b.keterangan, /Terukur dalam ROLL: 1 ROLL/); assert.ok(b.keterangan.includes("belum terukur dalam satuan stok (METER)")); assert.match(b.keterangan, /Tidak dikonversi/); assert.equal(b.nilaiLedger, 122 * 35500, "estimasi berbasis ledger tetap dihitung, terpisah");
  const lava = K({ saldo: 0, jumlahPergerakan: 3, bahan: bahan({ unit: "METER" }), hasilSO: SO() }); assert.equal(lava.status, STATUS.PENGAMATAN_FISIK); assert.equal(lava.nilaiLedger, null); assert.equal(lava.pengamatan, "13,5 ROLL");
});
test("N4b. nol dikonfirmasi pada bahan TANPA ledger: label 'fisik nol dikonfirmasi, belum tercatat sebagai hasil SO' — bukan 'sudah sesuai', tetap stok belum diketahui, tidak dinilai, bukan Rp0", () => {
  const b = K({ jumlahPergerakan: 0, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  assert.equal(b.status, STATUS.STOK_BELUM_DIKETAHUI); assert.equal(b.nilai, null); assert.equal(b.saldo, null); assert.match(b.keterangan, /Fisik nol dikonfirmasi/); assert.match(b.keterangan, /belum tercatat sebagai hasil SO di ledger/); assert.match(b.keterangan, /bukan "sudah sesuai"/);
  assert.equal(b.hasilSOBermasalah, false, "tidak bertentangan dengan ledger (tidak ada ledger)"); assert.equal(ringkasCakupan([b]).nolDikonfirmasiBelumDiLedger, 1);
});
test("N4c. nol dikonfirmasi tetapi ledger masih berisi: tetap dinilai dari ledger, DITANDAI bermasalah, dikecualikan dari estimasi 'tanpa hasil SO bermasalah'", () => {
  const baik = K({ saldo: 10 }), konflik = K({ saldo: 4, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }), minus = K({ saldo: -2, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  assert.equal(konflik.status, STATUS.DINILAI); assert.equal(konflik.hasilSOBermasalah, true); assert.match(konflik.keterangan, /selisih belum direkonsiliasi/); assert.equal(minus.status, STATUS.SALDO_MINUS); assert.equal(minus.hasilSOBermasalah, true);
  const e = hitungEstimasi([baik, konflik, minus]); assert.equal(e.nilaiLedger, 50000 + 20000); assert.equal(e.nilaiTanpaHasilSOBermasalah, 50000); assert.equal(e.bahanHasilSOBermasalah, 2); assert.equal(e.nilaiHasilSOBermasalah, 20000);
});
test("N4d. nol dikonfirmasi yang sejalan dengan saldo nol tidak bermasalah; peran pelihat nominal dihitung dari peta izin (finance:read ∩ inventory:read)", () => {
  const sejalan = K({ saldo: 0, jumlahPergerakan: 2, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }); assert.equal(sejalan.status, STATUS.SALDO_NOL); assert.equal(sejalan.hasilSOBermasalah, false); assert.match(sejalan.keterangan, /Sejalan dengan hasil SO nol/);
  const peran = peranPelihatNominal(); for (const r of ["ADMIN", "OWNER", "FINANCE"]) assert.ok(peran.includes(r), r); for (const r of ["WAREHOUSE", "SALES", "DRIVER"]) assert.ok(!peran.includes(r), r);
});
test("N5. harga kosong dengan saldo nol tetap saldo nol (tidak dilaporkan sebagai harga kosong)", () => {
  assert.equal(K({ saldo: 0, jumlahPergerakan: 2, harga: null }).status, STATUS.SALDO_NOL);
});
test("N6. cakupan: partisi lengkap, persentase, dan harga dari PO dihitung terpisah", () => {
  const baris = [K({}), K({ harga: harga({ sumber: "PO" }) }), K({ harga: null }), K({ saldo: -1 }), K({ saldo: 0, jumlahPergerakan: 1 })];
  const c = ringkasCakupan(baris); assert.equal(c.universe, 5); assert.equal(c.dinilai, 2); assert.equal(c.pengecualian, 2); assert.equal(c.saldoNol, 1); assert.equal(c.relevan, 4); assert.equal(c.persenDinilai, 50); assert.equal(c.dariPO, 1);
  assert.equal(Object.values(c.perStatus).reduce((a, v) => a + v, 0), c.universe, "tidak ada bahan terhitung dua kali / hilang");
});
test("N7. urutan tabel: yang berisiko dulu, pengecualian tidak tenggelam", () => {
  const baris = [K({ saldo: 0, jumlahPergerakan: 1 }), K({}), K({ saldo: -1 }), K({ jumlahPergerakan: 0, saldo: 0 }), K({ harga: null })];
  assert.deepEqual(urutkanRisiko(baris).map((b) => b.status), [STATUS.DINILAI, STATUS.SALDO_MINUS, STATUS.HARGA_KOSONG, STATUS.STOK_BELUM_DIKETAHUI, STATUS.SALDO_NOL]);
});

test("N8. catatan SO lama tidak terus mewakili saldo sekarang: pergerakan sesudah tanggal SO ⇒ KEDALUWARSA + peringatan + dikecualikan dari estimasi 'tanpa hasil SO bermasalah'", () => {
  const sesudah = { padaTanggal: 1, jumlah: 2, net: 7, terakhir: "2026-11-05T03:00:00.000Z" };
  const nol = K({ saldo: 7, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG", sesudah }) }); assert.equal(nol.hasilSO.status, "KEDALUWARSA_PERGERAKAN_BARU"); assert.equal(nol.hasilSO.kedaluwarsa, true); assert.equal(nol.hasilSOBermasalah, true); assert.match(nol.keterangan, /PERINGATAN: ada 2 pergerakan sesudah tanggal SO \(net 7/); assert.match(nol.keterangan, /tidak lagi mewakili saldo sekarang/); assert.match(nol.keterangan, /1 pergerakan terjadi pada tanggal SO/);
  assert.deepEqual(nol.hasilSO.pergerakanSesudah, sesudah);
  const ada = K({ jumlahPergerakan: 3, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG", sesudah }) }); assert.equal(ada.hasilSO.status, "KEDALUWARSA_PERGERAKAN_BARU", "saldo kembali 0 setelah ada pergerakan baru tetap tidak otomatis dianggap sejalan");
  const roll = K({ saldo: 122, bahan: bahan({ unit: "METER" }), harga: harga({ satuan: "METER" }), hasilSO: SO({ jumlah: 1, satuan: "ROLL", sesudah }) }); assert.equal(roll.status, STATUS.PENGAMATAN_FISIK); assert.equal(roll.hasilSO.status, "TERBUKA_SATUAN"); assert.equal(roll.hasilSO.kedaluwarsa, true); assert.match(roll.keterangan, /Pengecualian satuan masih terbuka/); assert.match(roll.keterangan, /tidak lagi mewakili saldo sekarang/);
  const bersih = K({ saldo: 0, jumlahPergerakan: 2, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }); assert.equal(bersih.hasilSO.status, "SEJALAN_BELUM_DISAHKAN"); assert.equal(bersih.hasilSO.kedaluwarsa, false);
});
test("N9. 178 nol: 'fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count' — TIDAK PERNAH berlabel Nol terverifikasi tanpa Stock Count; nol terverifikasi sungguhan tetap berlabel sendiri", () => {
  const b = K({ jumlahPergerakan: 0, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  assert.match(b.keterangan, /Fisik nol dikonfirmasi Owner/); assert.match(b.keterangan, /belum disahkan melalui Stock Count/); assert.equal(b.hasilSO.status, "BELUM_DISAHKAN_STOCK_COUNT"); assert.equal(b.hasilSO.statusTeks, "Fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count");
  assert.notEqual(b.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.doesNotMatch(JSON.stringify(b), /Nol terverifikasi/i);
  const sejalan = K({ jumlahPergerakan: 2, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }); assert.notEqual(sejalan.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.doesNotMatch(sejalan.keterangan, /terverifikasi/i); assert.match(sejalan.keterangan, /belum disahkan melalui Stock Count/);
  const ver = K({ jumlahPergerakan: 2, saldo: 0, nolTerverifikasi: true }); assert.equal(ver.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.match(ver.keterangan, /Nol terverifikasi — sumber bukti belum dirinci/);
  assert.equal(statusHasilSO({ so: SO({ jenis: "NOL_DIKONFIRMASI" }), keadaan: "MINUS", saldo: -2 }).bermasalah, true);
});

test("N10. label nol terverifikasi menurut SUMBER: Koreksi Saldo (dokumen + tanggal SO bila ditautkan) ≠ Stock Count; 178 pengamatan tetap 'Fisik nol dikonfirmasi Owner'", () => {
  const waktu = new Date("2026-11-05T00:05:06.000Z");
  const ks = K({ jumlahPergerakan: 2, saldo: 0, nolTerverifikasi: true, verifikasiNol: { sumber: "KOREKSI_SALDO", nomor: "ADJ-051126-02", waktu, soTanggal: "2026-11-04" } });
  assert.equal(ks.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.match(ks.keterangan, /^Nol terverifikasi — Koreksi Saldo ADJ-051126-02 [(]diposting 5 Nov 2026; SO 4 Nov 2026[)]/); assert.equal(ks.verifikasiNol.sumber, "KOREKSI_SALDO"); assert.equal(ks.verifikasiNol.nomor, "ADJ-051126-02"); assert.equal(ks.verifikasiNol.soTanggal, "2026-11-04"); assert.equal(ks.verifikasiNol.soDitautkan, true); assert.doesNotMatch(ks.keterangan, /Stock Count/);
  const tanpaTgl = K({ jumlahPergerakan: 2, saldo: 0, nolTerverifikasi: true, verifikasiNol: { sumber: "KOREKSI_SALDO", nomor: "ADJ-051126-03", waktu } }); assert.match(tanpaTgl.keterangan, /tanggal SO belum ditautkan/); assert.equal(tanpaTgl.verifikasiNol.soDitautkan, false, "tanggal SO tidak ditebak dari teks alasan");
  const sc = K({ jumlahPergerakan: 2, saldo: 0, nolTerverifikasi: true, verifikasiNol: { sumber: "STOCK_COUNT", nomor: "SC-0001", waktu } }); assert.match(sc.keterangan, /^Nol terverifikasi — Stock Count SC-0001 [(]5 Nov 2026[)]/); assert.doesNotMatch(sc.keterangan, /Koreksi Saldo/);
  assert.equal(labelNolTerverifikasi(null), "Nol terverifikasi — sumber bukti belum dirinci.");
  const so = K({ jumlahPergerakan: 0, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) }); assert.match(so.keterangan, /Fisik nol dikonfirmasi Owner/); assert.doesNotMatch(so.keterangan, /Nol terverifikasi/); assert.equal(so.verifikasiNol, null, "pengamatan tanpa penyesuaian bukan koreksi yang diposting");
  assert.equal(K({ jumlahPergerakan: 2, saldo: 0 }).verifikasiNol, null);
});

// ── Pemisahan 178 "fisik nol dikonfirmasi Owner" + cakupan kuantitas vs harga + sumber dokumen harga ──
import { SUB, dokumenHarga, PERINGATAN_HARGA } from "../src/services/nilaiPersediaan.js";
test("N20. STOK_BELUM_DIKETAHUI dipecah: nol dikonfirmasi Owner ≠ tanpa catatan stok; status induk, nilai, dan persen dinilai TIDAK berubah", () => {
  const nolOwner = K({ jumlahPergerakan: 0, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  const tanpa = K({ jumlahPergerakan: 0, saldo: 0 });
  assert.equal(nolOwner.status, STATUS.STOK_BELUM_DIKETAHUI); assert.equal(nolOwner.subStatus, SUB.NOL_DIKONFIRMASI_OWNER); assert.equal(nolOwner.nilai, null); assert.equal(nolOwner.saldo, null);
  assert.equal(tanpa.status, STATUS.STOK_BELUM_DIKETAHUI); assert.equal(tanpa.subStatus, SUB.TANPA_CATATAN_STOK);
  const c = ringkasCakupan([K({}), nolOwner, tanpa]);
  assert.equal(c.relevan, 3); assert.equal(c.dinilai, 1); assert.equal(c.persenDinilai, 33.3, "nol Owner TIDAK dikeluarkan dari penyebut untuk menaikkan persen");
  assert.deepEqual(c.perSubStatus, { NOL_DIKONFIRMASI_OWNER: 1, TANPA_CATATAN_STOK: 1 });
});
test("N21. cakupan kuantitas (ledger) dan cakupan harga dihitung TERPISAH; nol Owner tidak dihitung sebagai kuantitas ledger maupun 'berharga'", () => {
  const nolOwner = K({ jumlahPergerakan: 0, saldo: 0, hasilSO: SO({ jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "KG" }) });
  const baris = [K({}), K({ harga: null }), K({ saldo: 0, jumlahPergerakan: 3 }), K({ saldo: -2 }), nolOwner, K({ jumlahPergerakan: 0, saldo: 0 })];
  const c = ringkasCakupan(baris);
  assert.equal(c.kuantitas.universe, 6); assert.equal(c.kuantitas.diketahuiDiLedger, 4); assert.equal(c.kuantitas.persenDiketahuiDiLedger, 66.7);
  assert.equal(c.kuantitas.nolDikonfirmasiOwnerBelumDiLedger, 1); assert.equal(c.kuantitas.tidakDiketahui, 1);
  assert.equal(c.harga.bahanBersaldoPositif, 2); assert.equal(c.harga.denganHargaSatuanCocok, 1); assert.equal(c.harga.persenDenganHarga, 50); assert.equal(c.harga.tanpaHarga, 1);
  assert.equal(baris.filter((b) => b.status === STATUS.DINILAI).length, 1, "nol Owner bukan DINILAI");
});
test("N22. dokumenHarga: PO (nomor+baris), CSV (+baris), manual; selalu belum diverifikasi dan bukan bukti biaya perolehan", () => {
  assert.deepEqual(dokumenHarga({ idempotencyKey: "po-harga:x:y:r0", reason: "Otomatis dari PO PO-03112026-003 (baris 6, revisi 0) — draf PO dibuat", note: "", impact: { barisPO: 6 } }), { tipe: "PO", teks: "PO PO-03112026-003, baris 6" });
  assert.deepEqual(dokumenHarga({ idempotencyKey: "gilang-csv-x", reason: "Harga dari CSV GILANG dikonfirmasi Owner", note: "Sumber: ...GILANG.csv (SHA ...); baris CSV 365; satuan sumber PCS" }), { tipe: "CSV", teks: "CSV GILANG, baris 365" });
  assert.equal(dokumenHarga({ idempotencyKey: "k", reason: "input", note: "" }).tipe, "MANUAL");
  const b = K({ harga: harga({ dokumen: { tipe: "CSV", teks: "CSV GILANG, baris 365" } }) });
  assert.equal(b.harga.statusVerifikasi, "BELUM_DIVERIFIKASI"); assert.equal(b.harga.peringatan, PERINGATAN_HARGA); assert.match(b.harga.peringatan, /bukan bukti biaya perolehan/); assert.equal(b.harga.dokumen.teks, "CSV GILANG, baris 365");
  assert.equal(b.harga.nilai, 5000, "harga TIDAK diubah otomatis");
});
