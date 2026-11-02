// Pintu tunggal "Ubah tagihan", navigasi Pembelian yang disatukan, dan nominal yang jujur terhadap sen (kasus BILL-06102026-012: sisa tampil Rp0 tetapi status Dibayar sebagian).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kemampuanUbah, formatUangTepat, adaSen, sisaKurangSatuRupiah, tampilSisa } from "../src/features/finance/tagihan/tagihanLogika.js";
import { FINANCE_HUBS, cariItemHub } from "../src/lib/financeHubs.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8").replace(/\r\n/g, "\n");
const kunci = (k) => k.bagian.map((x) => x.kunci);
const bagian = (k, n) => k.bagian.find((x) => x.kunci === n);

test("navigasi: grup Pembelian punya tepat lima item utama berurutan, rute lama tetap", () => {
  const g = FINANCE_HUBS.find((h) => h.key === "pembelian");
  assert.deepEqual(g.items.map((i) => i.label), ["Pesanan (PO)", "Pembelian", "Tagihan supplier", "Jadwal pembayaran", "Retur"]);
  assert.deepEqual(g.items.map((i) => i.to), ["/finance/purchase-orders", "/finance/purchases", "/finance/suppliers", "/finance/suppliers?tab=aging", "/finance/retur-supplier"]);
  // Pembayaran dan Daftar supplier bukan item menu, tetapi tetap menyorot "Tagihan supplier" (deep link lama tidak putus)
  for (const tab of ["pembayaran", "supplier", "tagihan", ""]) assert.equal(cariItemHub("/finance/suppliers", tab ? `?tab=${tab}` : "").item.label, "Tagihan supplier", tab);
  assert.equal(cariItemHub("/finance/suppliers", "?tab=aging").item.label, "Jadwal pembayaran");
});

test("halaman: tidak ada baris tab kedua; Pembayaran & Daftar supplier lewat tombol pendukung; KPI hanya di tab tagihan", () => {
  const h = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.ok(!h.includes("fin-tg-tab-halaman") && !h.includes("tab-halaman-"), "baris tab internal dihapus");
  for (const t of ['data-testid="nav-pendukung"', 'data-testid="buka-pembayaran"', 'data-testid="buka-supplier"', 'data-testid="kembali-tagihan"']) assert.ok(h.includes(t), t);
  assert.match(h, /\{tab === "tagihan" && \(\s*<>\s*<RingkasanTagihan/);
  assert.ok(h.includes('useUrlTab(["tagihan", "aging", "pembayaran", "supplier"], "tagihan")'), "parameter ?tab= lama tetap diterima");
  assert.match(baca("../src/components/Topbar.jsx"), /"\/finance\/retur-supplier": \["Finance", "Retur"\]/);
});

test("status DITOLAK / DIBATALKAN: hanya riwayat, tidak ada jalan mengaktifkan kembali", () => {
  for (const status of ["DITOLAK", "DIBATALKAN"]) {
    const k = kemampuanUbah({ status }, { admin: true, bolehPost: true });
    assert.equal(k.mode, "NONAKTIF");
    assert.deepEqual(k.bagian, []);
    assert.match(k.pesan, /tidak bisa/i);
    assert.ok(k.jalan.length > 0);
  }
  const diganti = kemampuanUbah({ status: "DIBATALKAN", replacedBy: { billNumber: "BILL-9" } }, { admin: true });
  assert.match(diganti.pesan, /BILL-9/);
  assert.equal(diganti.jalan[0].kunci, "versi-baru");
});

test("belum disetujui: faktur atas PO → editor faktur PO; selain itu → ubah isi; tanpa izin dikunci dengan alasan", () => {
  const manual = kemampuanUbah({ status: "MENUNGGU_APPROVAL" }, { admin: false, bolehPost: true });
  assert.equal(manual.mode, "BELUM_DISETUJUI");
  assert.deepEqual(kunci(manual), ["isi"]);
  assert.equal(bagian(manual, "isi").tersedia, true);
  assert.ok(bagian(manual, "isi").bidang.includes("Nominal") && bagian(manual, "isi").bidang.includes("Supplier"));
  const po = kemampuanUbah({ status: "DRAFT", purchaseOrderId: "po1" }, { bolehPost: true });
  assert.deepEqual(kunci(po), ["faktur-po"]);
  assert.equal(po.terkunci.length, 1, "supplier/PO asal dikunci dengan alasan");
  assert.match(po.terkunci[0].alasan, /tolak/i);
  const tanpa = kemampuanUbah({ status: "DRAFT" }, { bolehPost: false });
  assert.equal(bagian(tanpa, "isi").tersedia, false);
  assert.match(bagian(tanpa, "isi").alasan, /izin/i);
});

test("sudah disetujui: Informasi dokumen dibedakan dari Koreksi transaksi; koreksi mengikuti alasan server (b.koreksi)", () => {
  const bebas = kemampuanUbah({ status: "DISETUJUI", terbayar: 0, koreksi: { aktif: true } }, { admin: true, bolehPost: true });
  assert.deepEqual(kunci(bebas), ["info", "koreksi"]);
  assert.ok(bagian(bebas, "info").tersedia && bagian(bebas, "koreksi").tersedia);
  assert.deepEqual(bagian(bebas, "info").bidang, ["Nomor faktur supplier", "Jatuh tempo"], "endpoint info tidak diperlebar");
  assert.equal(bebas.bayar, false);
  assert.ok(bebas.terkunci.some((t) => /Jenis tagihan/.test(t.judul)));

  const bukanAdmin = kemampuanUbah({ status: "DISETUJUI", koreksi: { aktif: true } }, { admin: false, bolehPost: true });
  assert.equal(bagian(bukanAdmin, "koreksi").tersedia, false);
  assert.equal(bagian(bukanAdmin, "info").tersedia, true);

  const po = kemampuanUbah({ status: "DISETUJUI", purchaseOrderId: "po1", koreksi: { aktif: false, kode: "FAKTUR_ATAS_PO", alasan: "Faktur atas PO tidak bisa dikoreksi langsung.", arah: "Batalkan lalu catat ulang." } }, { admin: true, bolehPost: true });
  assert.equal(bagian(po, "koreksi").tersedia, false);
  assert.match(bagian(po, "koreksi").alasan, /Faktur atas PO/);
  assert.equal(bagian(po, "koreksi").jalan[0].kunci, "batalkan");
});

test("dibayar sebagian / lunas: pembayaran terkait ditampilkan dan koreksi mengikuti blokir server, tidak pernah mengubah pembayaran sendiri", () => {
  for (const status of ["DIBAYAR_SEBAGIAN", "LUNAS"]) {
    const k = kemampuanUbah({ status, terbayar: 100, koreksi: { aktif: false, kode: "ADA_PEMBAYARAN", alasan: "Ada pembayaran aktif.", arah: "Batalkan pembayarannya dulu." } }, { admin: true, bolehPost: true });
    assert.equal(k.bayar, true);
    assert.equal(bagian(k, "koreksi").tersedia, false);
    assert.match(bagian(k, "koreksi").alasan, /pembayaran/i);
    assert.equal(bagian(k, "koreksi").jalan[0].kunci, "pembayaran");
    assert.equal(bagian(k, "info").tersedia, true, "informasi dokumen tidak menyentuh pembayaran");
  }
  const dlg = baca("../src/features/finance/tagihan/UbahTagihan.jsx");
  assert.ok(dlg.includes("tidak membatalkan, memindahkan, atau mengurangi pembayaran secara otomatis"));
  assert.ok(!/api\./.test(dlg), "dialog pintu tunggal tidak memanggil API sendiri");
});

test("satu pintu: menu baris & rincian memakai 'Ubah tagihan'; edit/info/koreksi tidak lagi menjadi tiga menu; tanpa window.prompt/confirm di alur tagihan", () => {
  const h = baca("../src/pages/finance/FinanceSuppliers.jsx");
  const blok = h.slice(h.indexOf("function aksiTagihan("), h.indexOf("// Pembayaran supplier: koreksi langsung"));
  assert.ok(blok.includes('label: "Ubah tagihan"') && blok.includes('const lepas = new Set(["edit", "info", "koreksi"])'));
  assert.ok(!blok.includes("window.prompt") && !blok.includes("window.confirm") && !blok.includes("confirmText"), "Setujui/Tolak/Batalkan memakai dialog aplikasi");
  assert.ok(h.includes("<DialogAlasan") && h.includes("<DialogSetujui") && h.includes("<UbahTagihan"));
  assert.equal((h.match(/aksi=\{aksiBaris\}/g) || []).length, 2, "daftar dan rincian memakai satu pembangun aksi");
  // jalur transaksi yang SUDAH ADA, bukan jalur kedua
  for (const s of ["api.editFinanceBill(editUntuk.id, d)", "api.rejectFinanceBill(alasanUntuk.b.id, alasan)", "api.cancelFinanceBill(alasanUntuk.b.id, alasan)", "api.approveFinanceBill(setujuiUntuk.id)", "<ModalFaktur", "<InfoDialog", "<KoreksiDialog"]) assert.ok(h.includes(s), s);
});

test("ubah isi: ganti supplier melepas penerimaan tertaut dengan pemberitahuan; ringkasan sebelum→sesudah; galat tidak menghapus isian", () => {
  const h = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.ok(h.includes('goodsReceiptId: ""') && h.includes("catatan-lepas-penerimaan") && h.includes("Penerimaan yang tertaut dilepas karena supplier diganti"));
  assert.ok(h.includes('data-testid="ringkasan-perubahan"'));
  assert.ok(h.includes("catch (e) { setGalat(") && h.includes('<Galat pesan={galat} testid="galat-ubah-isi" />'));
  const d = baca("../src/features/finance/tagihan/DialogTagihan.jsx");
  assert.ok(d.includes("Alasan wajib diisi.") && d.includes("TombolAksi"), "alasan wajib + kunci klik ganda");
  assert.ok(!d.includes("window.prompt(") && !d.includes("window.confirm(") && !d.includes("window.alert("), "tanpa dialog bawaan browser");
});

test("nominal jujur terhadap sen: Rp7.993.820,37 tidak lagi tampil Rp7.993.820; bulat tetap tanpa desimal", () => {
  assert.equal(formatUangTepat(7993820.37), "Rp7.993.820,37");
  assert.equal(formatUangTepat(7993820), "Rp7.993.820");
  assert.equal(formatUangTepat(0.37), "Rp0,37");
  assert.equal(formatUangTepat(0), "Rp0");
  assert.equal(formatUangTepat(0.004), "Rp0", "di bawah setengah sen dianggap nol (presisi Decimal(18,2))");
  assert.equal(formatUangTepat(-12.5), "(Rp12,50)");
  assert.equal(adaSen(10), false);
  assert.equal(adaSen(10.01), true);
});

test("kasus screenshot: sisa 0,37 pada tagihan terbuka ditandai sebagai selisih sen, tidak disembunyikan dan angkanya tidak diubah", () => {
  const b = { status: "DIBAYAR_SEBAGIAN", amount: 7993820.37, terbayar: 7993820, sisa: 0.37, dueDate: "2026-10-30" };
  assert.equal(sisaKurangSatuRupiah(b), true);
  assert.equal(tampilSisa(b).nilai, 0.37, "angka server tidak diubah");
  assert.equal(formatUangTepat(tampilSisa(b).nilai), "Rp0,37");
  assert.equal(sisaKurangSatuRupiah({ ...b, sisa: 0 }), false, "sisa nol sungguhan tidak diberi penjelasan");
  assert.equal(sisaKurangSatuRupiah({ ...b, status: "LUNAS", sisa: 0.37 }), false);
  const h = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.ok(h.includes('step="0.01"') && h.includes("lunasi-") && h.includes("String(Number(b.sisa))"), "form pembayaran: Lunasi mengisi tepat sisa, langkah 0,01");
  assert.ok(!/Math\.round\(.*sisa|toleransi/i.test(baca("../src/features/finance/tagihan/tagihanLogika.js").split("Uang yang jujur terhadap sen")[1]), "tanpa toleransi/pembulatan yang menyembunyikan sisa");
});

test("pratinjau koreksi (KoreksiAman) jujur terhadap sen dan tidak mengubah tampilan nominal bulat", () => {
  const k = baca("../src/features/finance/KoreksiAman.jsx");
  assert.ok(k.includes("formatUang as formatUangBulat") && k.includes("const formatUang = (n, opsi)"));
  assert.ok(k.includes("{ ...opsi, sen: true }") && k.includes("formatUangBulat(v, opsi)"), "nominal bulat memakai formatter bersama persis seperti sebelumnya");
  assert.ok(k.includes('step="0.01" aria-label={k.label}'), "kolom nominal koreksi menerima sen");
});
