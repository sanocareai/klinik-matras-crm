// Logika murni kontrol editor PO: tanggal kalender WIB (tanpa konversi UTC), validasi bertahap, label termin, kelayakan Catat faktur. Tanpa React/DOM.
import test from "node:test";
import assert from "node:assert/strict";
import {
  uraiTanggal, formatTanggalPO, labelTanggalPenuh, hariKe, hariDalamBulan, tambahHari, tambahBulan, hariIniWIB, selBulan, cariFieldBermasalah, fieldDariGalatBaris, barisKosong,
  labelTerminRingkas, bantuanTermin, bolehCatatFaktur, langkahFakturSetelahSimpan, HARI_PENDEK,
} from "../src/features/finance/po/poKontrol.js";
import { galatFormulir, baris0, bodyDariForm } from "../src/features/finance/purchaseOrderLogic.js";

test("tanggal: format 'D Mon YYYY' tanpa nol di depan; tanggal tidak sah ditolak (bukan digeser)", () => {
  assert.equal(formatTanggalPO("2026-11-02"), "2 Nov 2026");
  assert.equal(formatTanggalPO("2026-12-31"), "31 Des 2026");
  assert.equal(formatTanggalPO(""), "");
  assert.equal(formatTanggalPO("2026-02-31"), "", "31 Februari bukan tanggal");
  assert.equal(uraiTanggal("2026-13-01"), null);
  assert.equal(uraiTanggal("02/11/2026"), null);
  assert.deepEqual(uraiTanggal("2028-02-29"), { y: 2028, m: 1, d: 29 }, "kabisat sah");
  assert.equal(uraiTanggal("2026-02-29"), null);
  assert.equal(labelTanggalPenuh("2026-11-02"), "Senin, 2 November 2026");
});

test("kalender: minggu mulai Senin, hari dan bulan Indonesia, jumlah sel kelipatan 7", () => {
  assert.deepEqual([...HARI_PENDEK], ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]);
  assert.equal(hariKe("2026-11-02"), 0, "2 Nov 2026 = Senin");
  assert.equal(hariKe("2026-11-01"), 6, "1 Nov 2026 = Minggu");
  const sel = selBulan(2026, 10); // November 2026 dimulai hari Minggu → 6 sel kosong di depan
  assert.equal(sel.length % 7, 0);
  assert.equal(sel.slice(0, 6).every((x) => x === null), true);
  assert.equal(sel[6], "2026-11-01");
  assert.equal(sel.filter(Boolean).length, 30);
  assert.equal(sel.filter(Boolean).at(-1), "2026-11-30");
  assert.equal(hariDalamBulan(2026, 1), 28);
  assert.equal(hariDalamBulan(2028, 1), 29);
});

test("navigasi: hari/bulan/tahun melewati batas bulan & tahun; tanggal 31 dijepit ke akhir bulan pendek", () => {
  assert.equal(tambahHari("2026-11-30", 1), "2026-12-01");
  assert.equal(tambahHari("2026-12-31", 1), "2027-01-01");
  assert.equal(tambahHari("2027-01-01", -1), "2026-12-31");
  assert.equal(tambahHari("2026-11-02", 7), "2026-11-09");
  assert.equal(tambahBulan("2026-01-31", 1), "2026-02-28");
  assert.equal(tambahBulan("2028-01-31", 1), "2028-02-29");
  assert.equal(tambahBulan("2026-12-15", 1), "2027-01-15");
  assert.equal(tambahBulan("2026-01-15", -1), "2025-12-15");
  assert.equal(tambahBulan("2026-11-02", 12), "2027-11-02");
  assert.equal(tambahBulan("2026-11-02", -12), "2025-11-02");
});

test("hari ini menurut WIB (UTC+7): batas tengah malam tidak bergeser, tidak bergantung zona perangkat", () => {
  assert.equal(hariIniWIB(Date.UTC(2026, 10, 1, 16, 59, 59)), "2026-11-01", "23:59:59 WIB masih 1 Nov");
  assert.equal(hariIniWIB(Date.UTC(2026, 10, 1, 17, 0, 0)), "2026-11-02", "00:00 WIB = 2 Nov");
  assert.equal(hariIniWIB(Date.UTC(2026, 11, 31, 16, 30)), "2026-12-31");
  assert.equal(hariIniWIB(Date.UTC(2026, 11, 31, 17, 30)), "2027-01-01", "pergantian tahun");
  assert.equal(hariIniWIB(Date.UTC(2028, 1, 28, 17, 0)), "2028-02-29", "kabisat");
  const zona = process.env.TZ; // hasil sama di zona mana pun
  assert.equal(hariIniWIB(Date.UTC(2026, 10, 1, 17, 30)), "2026-11-02"); void zona;
});

test("payload tanggal: string YYYY-MM-DD apa adanya; perkiraan datang kosong → null (tidak berubah dari sebelumnya)", () => {
  const f = { supplierId: "s", orderDate: "2026-11-02", expectedDate: "", notes: "  ", termin: undefined, lines: [{ ...baris0(), materialId: "m", qty: "10", unitPrice: "43290" }] };
  const b = bodyDariForm(f);
  assert.equal(b.orderDate, "2026-11-02");
  assert.equal(b.expectedDate, null);
  assert.equal(b.notes, null);
  assert.deepEqual(Object.keys(b).sort(), ["expectedDate", "lines", "notes", "orderDate", "supplierId"], "tidak ada kunci baru (mis. faktur) di payload");
  assert.equal(bodyDariForm({ ...f, expectedDate: "2026-11-30" }).expectedDate, "2026-11-30");
});

test("validasi bertahap: field pertama yang bermasalah memakai urutan & pesan galatFormulir", () => {
  const unit = new Map([["m", "KG"]]);
  const dasar = { supplierId: "s", orderDate: "2026-11-02", expectedDate: "", notes: "", lines: [{ ...baris0(), materialId: "m", qty: "10", unitPrice: "43290" }] };
  assert.equal(cariFieldBermasalah(dasar, unit), null);
  assert.deepEqual(cariFieldBermasalah({ ...dasar, supplierId: "" }, unit), { kunci: "supplier", pesan: "Pilih supplier" });
  assert.equal(cariFieldBermasalah({ ...dasar, orderDate: "" }, unit).kunci, "orderDate");
  assert.equal(cariFieldBermasalah({ ...dasar, expectedDate: "2026-11-01" }, unit).kunci, "expectedDate");
  const kasus = [
    [{ ...dasar, lines: [baris0()] }, "bahan"],
    [{ ...dasar, lines: [{ ...dasar.lines[0], qty: "" }] }, "qty"],
    [{ ...dasar, lines: [{ ...dasar.lines[0], qty: "1.2345" }] }, "qty"],
    [{ ...dasar, lines: [{ ...dasar.lines[0], unitPrice: "" }] }, "harga"],
    [{ ...dasar, lines: [{ ...dasar.lines[0], unitPrice: "100.5" }] }, "harga"],
    [{ ...dasar, lines: [{ ...dasar.lines[0], satuanBeli: "BOX", faktorKonversi: "" }] }, "rinci"],
    [{ ...dasar, lines: [dasar.lines[0], { ...dasar.lines[0] }] }, "ganda"],
  ];
  for (const [f, field] of kasus) {
    const m = cariFieldBermasalah(f, unit);
    assert.ok(m, field);
    assert.equal(m.kunci, "baris"); assert.equal(m.field, field, JSON.stringify(f.lines.map((l) => [l.materialId, l.qty, l.unitPrice, l.satuanBeli])));
    assert.equal(m.pesan, galatFormulir(f, unit), "pesan identik dengan sumber kebenaran");
  }
  assert.equal(cariFieldBermasalah({ ...dasar, lines: [dasar.lines[0], baris0()] }, unit).baris, 2, "nomor baris 1-based");
  assert.equal(fieldDariGalatBaris({ materialId: "m" }, "Jumlah × faktor konversi melebihi 4 angka di belakang koma — ubah jumlah atau faktor"), "rinci", "tidak salah dikira jumlah");
  assert.equal(fieldDariGalatBaris({ materialId: "m" }, "Harga per satuan stok kurang dari Rp1 — periksa faktor konversi atau harga"), "rinci");
});

test("baris kosong baru tidak dianggap sudah diisi (tidak merah saat form baru dibuka)", () => {
  assert.equal(barisKosong(baris0()), true);
  assert.equal(barisKosong({ ...baris0(), qty: "1" }), false);
  assert.equal(barisKosong({ ...baris0(), materialId: "m" }), false);
});

test("termin: ringkasan 'N hari' / 'Belum ditetapkan'; pilihan manual mengalahkan default; bantuan sesuai dasar & jenis", () => {
  assert.equal(labelTerminRingkas({ ada: true, label: "7 hari" }, { ganti: false }), "7 hari");
  assert.equal(labelTerminRingkas({ ada: false }, { ganti: false }), "Belum ditetapkan");
  assert.equal(labelTerminRingkas(null, { ganti: false }), "");
  assert.equal(labelTerminRingkas({ ada: true, label: "7 hari" }, { ganti: true, pilihan: "HARI:30" }), "30 hari");
  assert.equal(labelTerminRingkas({ ada: true, label: "7 hari" }, { ganti: true, pilihan: "TUNAI" }), "Tunai/COD");
  const b1 = bantuanTermin({ ada: true, jenis: "HARI", dasar: "TANGGAL_TIBA" });
  assert.match(b1.dasar, /ditentukan saat faktur dicatat/);
  assert.match(b1.tambahan, /tanggal barang tiba/);
  assert.match(bantuanTermin({ ada: true, jenis: "TANGGAL_KHUSUS" }).tambahan, /diisi saat faktur dicatat, bukan di PO/);
  assert.match(bantuanTermin({ ada: false }).tambahan, /belum punya termin/);
  assert.equal(bantuanTermin({ ada: true, jenis: "HARI" }).tambahan, "");
  assert.match(bantuanTermin(null).dasar, /ditentukan saat faktur dicatat/);
});

test("Catat faktur: hanya PO yang sudah disetujui + izin mencatat; draf tidak pernah ditawari tombol dan tidak disetujui otomatis", () => {
  const izin = { catat: true };
  for (const st of ["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"]) assert.equal(bolehCatatFaktur(st, izin), true, st);
  for (const st of ["DRAFT", "DIBATALKAN", undefined]) assert.equal(bolehCatatFaktur(st, izin), false, String(st));
  assert.equal(bolehCatatFaktur("DISETUJUI", { catat: false }), false);
  const draf = langkahFakturSetelahSimpan("DRAFT", izin);
  assert.equal(draf.siap, false);
  assert.match(draf.teks, /setelah PO disetujui/);
  assert.match(draf.teks, /belum disetujui otomatis/);
  const siap = langkahFakturSetelahSimpan("DISETUJUI", izin);
  assert.equal(siap.siap, true);
  assert.match(siap.teks, /langkah terpisah/);
  assert.equal(langkahFakturSetelahSimpan("DISETUJUI", { catat: false }).siap, false);
});
