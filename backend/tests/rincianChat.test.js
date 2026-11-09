import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseFilterChat, pilihAkuisisi, cocokFilter, hasilCustomer, rapikanPesan, bangunExcelMarketing } from "../src/services/attribution/rincianChat.js";
import { sumberDariCustomer, hitungSumber, sorotan, SUMBER } from "../src/services/attribution/sumber.js";
import { detailSumberTampil } from "../src/services/attribution/keteranganSumber.js";

test("filter menolak pemilih ganda, ID bukan angka, dan sumber asing", () => {
  assert.throws(() => parseFilterChat({ sumber: "META", adId: "1234567" }));
  assert.throws(() => parseFilterChat({ adId: "abc" }));
  assert.throws(() => parseFilterChat({ sumber: "NGASAL" }));
  assert.throws(() => parseFilterChat({}));
  assert.throws(() => parseFilterChat({ sumber: "META", hasil: "x" }));
  assert.throws(() => parseFilterChat({ sumber: "META", halaman: "0" }));
  assert.equal(parseFilterChat({}, { wajibPemilih: false }).hasil, "semua");
  assert.equal(parseFilterChat({ tanpaIklan: "1" }).tanpaIklan, true);
});

test("akuisisi = touch pertama per customer, urut waktu lalu id", () => {
  const p = pilihAkuisisi([
    { id: "b", customerId: "c1", adId: "kedua", touchAt: "2026-11-02T00:00:00Z" },
    { id: "a", customerId: "c1", adId: "pertama", touchAt: "2026-11-01T00:00:00Z" },
    { id: "z", customerId: "c2", adId: "z", touchAt: "2026-11-01T00:00:00Z" },
    { id: "y", customerId: "c2", adId: "y", touchAt: "2026-11-01T00:00:00Z" },
  ]);
  assert.equal(p.get("c1").adId, "pertama");
  assert.equal(p.get("c2").adId, "y");
});

test("pemilih: iklan tidak terbaca hanya label Meta tanpa touch; iklan tidak pernah ditebak dari label", () => {
  const meta = { leadSource: "META_ADS" }; const wa = { leadSource: "WHATSAPP_DIRECT" };
  const t = { adId: "111" }; const r = { adSetId: "222", campaignId: "333", adName: "Kreatif" };
  assert.equal(cocokFilter(meta, null, null, { tanpaIklan: true }), true);
  assert.equal(cocokFilter(meta, t, r, { tanpaIklan: true }), false);
  assert.equal(cocokFilter(wa, null, null, { tanpaIklan: true }), false);
  assert.equal(cocokFilter(meta, t, r, { adId: "111" }), true);
  assert.equal(cocokFilter(meta, null, null, { adId: "111" }), false);
  assert.equal(cocokFilter(meta, t, r, { adSetId: "222" }), true);
  assert.equal(cocokFilter(meta, t, r, { campaignId: "333" }), true);
  assert.equal(cocokFilter(meta, t, r, { kreatif: "Kreatif" }), true);
  assert.equal(cocokFilter(meta, t, null, { campaignId: "333" }), false);
  assert.equal(cocokFilter(meta, t, r, { sumber: "META" }), true);
  assert.equal(cocokFilter(wa, null, null, {}), true);
});

test("Dimulai Sales dipisah dari Lainnya; total lead tidak berubah dan tidak ikut sorotan", () => {
  assert.equal(sumberDariCustomer({ leadSource: "OTHER", leadSourceDetail: "Dimulai manual oleh sales dari CRM" }), "DIMULAI_SALES");
  assert.equal(sumberDariCustomer({ leadSource: "OTHER", leadSourceDetail: "Dimulai sales (chat pertama dari kita)" }), "DIMULAI_SALES");
  assert.equal(sumberDariCustomer({ leadSource: "OTHER", leadSourceDetail: "Website - chatgpt-com" }), "LAINNYA");
  assert.equal(sumberDariCustomer({ leadSource: "OTHER", leadSourceDetail: null }), "LAINNYA");
  assert.equal(sumberDariCustomer({ leadSource: "B2B_DIRECT" }), null);
  const c = (id, leadSourceDetail) => ({ id, createdAt: new Date(), pipelineStage: "LEAD", leadSource: "OTHER", leadSourceDetail, isInternalStaff: false, staffUserId: null, transitions: [] });
  const { per } = hitungSumber({ customers: [c("a", "Dimulai sales (chat pertama dari kita)"), c("b", "Website - threads-social")], orders: [], kontribusi: [], refunds: [] });
  assert.equal(per.get("DIMULAI_SALES").lead, 1);
  assert.equal(per.get("LAINNYA").lead, 1);
  const sor = sorotan([{ id: "DIMULAI_SALES", jenis: "INTERNAL", lead: 99, berOrder: 9, lunas: 9, sampelKecil: false, konversiOrder: { nilai: 99 } }]);
  assert.deepEqual(sor, []);
  assert.ok(SUMBER.every((s) => s.kelompok && s.tingkatBukti));
});

test("hasil customer: spam tidak dihitung ber-order; order batal dan karyawan dilewati; status bayar dari ledger", () => {
  const o = (id, x = {}) => ({ id, status: "CONFIRMED", value: 1000, tagihan: 1000, paymentStatus: "BELUM", penjualanKaryawanId: null, ...x });
  const sah = { pipelineStage: "LEAD", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null };
  const spam = hasilCustomer({ ...sah, pipelineStage: "SPAM" }, [o("1")], new Map(), new Map());
  assert.deepEqual([spam.spam, spam.berOrder], [true, false]);
  const batal = hasilCustomer(sah, [o("1", { status: "CANCELLED" }), o("2", { penjualanKaryawanId: "k" })], new Map(), new Map());
  assert.equal(batal.berOrder, false);
  const belum = hasilCustomer(sah, [o("1")], new Map(), new Map());
  assert.deepEqual([belum.berOrder, belum.nilaiOrder, belum.statusBayar], [true, 1000, "Belum bayar"]);
  const tidakTahu = hasilCustomer(sah, [o("1", { paymentStatus: "LUNAS" })], new Map(), new Map());
  assert.equal(tidakTahu.statusBayar, "Tidak diketahui");
});

test("pesan dibersihkan dari kode klik tak terlihat", () => {
  assert.equal(rapikanPesan("Halo​‌‍  kak\n\ntanya⁠"), "Halo kak tanya");
  assert.equal(rapikanPesan(null), "");
  assert.equal(rapikanPesan("x".repeat(500)).length, 300);
});

test("keterangan Kemungkinan TikTok tampil sebagai Tanpa bukti sumber", () => {
  assert.equal(detailSumberTampil("Kemungkinan TikTok, belum terbukti (hanya cocok klik)"), "Tanpa bukti sumber");
  assert.equal(detailSumberTampil("TikTok Ads - AG01"), "TikTok Ads - AG01");
  assert.equal(detailSumberTampil("Meta CTWA - instagram.com/p/X"), "Meta CTWA - instagram - instagram.com/p/X");
});

test("Excel berisi tiga lembar, nomor lengkap sebagai teks, dan teks berawalan = bukan rumus", async () => {
  const buf = await bangunExcelMarketing({
    periode: { dari: "2026-11-01", sampai: "2026-11-09" }, asalUrl: "https://contoh.test",
    sumber: { sumber: [{ kelompok: "Iklan berbayar", label: "Meta Ads", tingkatBukti: "Kuat", lead: 2, spam: 0, leadSah: 2, berOrder: 1, membayar: 1, lunas: 0, uang: { nilaiOrderSaatIni: 5000, uangBersih: 100 }, biaya: { spend: 900 } }] },
    iklan: { grup: [
      { status: "MAPPED", campaign: { id: "1", nama: "C" }, adSet: { id: "2", nama: "S" }, ad: { id: "3", nama: "A" }, lead: { unik: 2, spam: 0 }, customerDenganOrder: 1, customerPernahMembayar: 1, closingUtama: { customerLunasTerbuktiLedger: 0 }, bookedValue: 5000, uangBersihLedger: 100, biaya: { spend: 900 } },
      { status: "UNKNOWN", lead: { unik: 9, spam: 0 }, closingUtama: {} },
    ] },
    chat: [{ tanggal: "2026-11-09 10:00", nama: "Budi", nomor: "6281200001111", sumberId: "META", sumberLabel: "META_ADS", keterangan: null, iklan: null, pesanPertama: "=1+1", sales: null, stage: "LEAD", jumlahOrder: 0, nilaiOrder: 0, statusBayar: null, conversationId: "conv1" }],
  });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Ringkasan Sumber", "Per Iklan", "Daftar Chat"]);
  assert.equal(wb.getWorksheet("Per Iklan").rowCount, 3);   // catatan + kepala + satu baris; UNKNOWN tidak dikreditkan
  const chat = wb.getWorksheet("Daftar Chat").getRow(2);
  assert.equal(chat.getCell(3).value, "6281200001111");
  assert.equal(chat.getCell(6).value, "Iklan tidak terbaca");
  assert.equal(chat.getCell(10).value, "=1+1");
  assert.equal(chat.getCell(16).value.hyperlink, "https://contoh.test/inbox?conv=conv1");
});
