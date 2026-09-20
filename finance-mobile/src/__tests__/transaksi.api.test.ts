// Kontrak klien untuk transaksi S6–S8: pemetaan respons server (uang string desimal, aksi dari server, alamat perintah dipercaya hanya untuk dokumen
// keuangan), isi permintaan tiap perintah (uang string, nilai tetap dari server), guard izin/alamat, dan aritmetika desimal BigInt untuk formulir.

/* eslint-disable import/first */
jest.mock("@/lib/env", () => ({ ENV: { useMocks: false, apiUrl: "http://x/api" } }));

import { ApiError } from "@/api/errors";
import { bodyAksi, bodyBuat, jalankanAksiTx, mapDetailTx, mapHalamanTx, mapItemTx, mapOpsiForm, needBuat, petaAksiTx } from "@/api/transaksi";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { bandingMoney, jumlahMoney, kurangMoney, parseInputRupiah, tambahMoney, type Money } from "@/lib/money";

const aksi = (o: object = {}) => ({ boleh: true, alasan: null, path: "/finance/expenses/e1/pay", metode: "POST", perlu: ["rekening"], ...o });
const item = (o: object = {}) => ({
  kunci: "pengeluaran:e1", id: "e1", modul: "pengeluaran", nomor: "EXP-1", tanggal: "2026-09-20", nominal: "150000.00", judul: "Servis", sub: "x", pihak: null, rekening: "KEM",
  status: "MENUNGGU_APPROVAL", statusLabel: "Menunggu persetujuan", nada: "warning", jatuhTempo: null, umurHari: null, sisa: null, terbayar: null, adaLampiran: false, notaWajib: true,
  persetujuan: { jenis: "expense", id: "e1" }, aksi: { bayar: aksi() }, ...o,
});

describe("pemetaan respons", () => {
  it("item: uang tetap string desimal; aksi & tautan Inbox S4 dari server", () => {
    const i = mapItemTx(item());
    expect(i?.nominal).toBe("150000.00");
    expect(typeof i?.nominal).toBe("string");
    expect(i?.persetujuan).toEqual({ jenis: "expense", id: "e1" });
    expect(i?.notaWajib).toBe(true);
    expect(i?.aksi.bayar?.boleh).toBe(true);
    expect(i?.aksi.bayar?.perlu).toEqual(["rekening"]);
  });

  it("nominal yang bukan string desimal ditolak (tidak ada float diam-diam); modul tak dikenal ditolak", () => {
    expect(mapItemTx(item({ nominal: 150000 }))).toBeNull();
    expect(mapItemTx(item({ nominal: "abc" }))).toBeNull();
    expect(mapItemTx(item({ modul: "jurnal" }))).toBeNull();
    expect(mapItemTx(item({ id: undefined }))).toBeNull();
  });

  it("aksi dengan alamat di luar dokumen keuangan dimatikan (tombol nonaktif lebih baik daripada memanggil alamat asing)", () => {
    expect(petaAksiTx(aksi()).boleh).toBe(true);
    expect(petaAksiTx(aksi({ path: "/admin/hapus" })).boleh).toBe(false);
    expect(petaAksiTx(aksi({ path: "https://evil.example/finance/expenses/1/pay" })).boleh).toBe(false);
    expect(petaAksiTx(aksi({ boleh: false, alasan: "Hanya untuk admin." })).alasan).toBe("Hanya untuk admin.");
    expect(petaAksiTx({ boleh: true }).boleh).toBe(false);
    expect(petaAksiTx(aksi({ metode: "PATCH", path: "/finance/suppliers/s1" })).metode).toBe("PATCH");
  });

  it("halaman: hitungan tab, ringkasan uang string, penanda halaman berikutnya", () => {
    const h = mapHalamanTx({
      items: [item(), { bukan: "item" }], tab: "MENUNGGU", page: 2, total: 41, adaLagi: true, hitung: { MENUNGGU: 3, SEMUA: 41 },
      ringkasan: { total: "1500000.00", lewatTempo: { jumlah: 2, total: "300000.00" }, umur: { "1_30": "300000.00", buruk: 5 } }, diperbaruiPada: "2026-09-21T01:00:00.000Z",
    });
    expect(h.items).toHaveLength(1);
    expect(h.page).toBe(2);
    expect(h.adaLagi).toBe(true);
    expect(h.hitung).toEqual({ MENUNGGU: 3, SEMUA: 41 });
    expect(h.ringkasan.total).toBe("1500000.00");
    expect(h.ringkasan.lewatTempo).toEqual({ jumlah: 2, total: "300000.00" });
    expect(h.ringkasan.umur).toEqual({ "1_30": "300000.00" });
  });

  it("detail: bagian (uang hanya string sah), tautan, lampiran bertanda-tangan, pembayaran + alokasi piutang", () => {
    const d = mapDetailTx({
      ...item({ modul: "piutang", kunci: "piutang:o1", id: "o1", sisa: "1500000.00" }),
      bagian: [{ judul: "Tagihan", baris: [{ label: "Sisa", nilai: "1500000.00", jenis: "uang" }, { label: "Rusak", nilai: "x", jenis: "uang" }, { label: "Refund", nilai: "RFD-1", jenis: "teks", tautan: { modul: "refund", id: "r1" } }] }],
      lampiran: [{ id: "a.jpg", jenis: "foto", url: "/media/finance-receipts/a.jpg?exp=1&sig=2", thumbUrl: "https://luar/x.jpg", kedaluwarsa: null }],
      pembayaran: [{ id: "pay1", nominal: "500000.00", metode: "TRANSFER", tanggal: "2026-09-10", status: "TERVERIFIKASI", statusLabel: "Terverifikasi", asalOrderId: "o1", alokasi: [{ orderId: "o1", nomor: "SAN-1", nominal: "500000.00" }], aksiAlokasi: aksi({ path: "/finance/customer-payments/pay1/allocations", perlu: ["alokasi"] }) }],
      orderPelanggan: [{ id: "o1", nomor: "SAN-1" }], riwayat: [{ waktu: "2026-09-20T00:00:00Z", peristiwa: "X", label: "Diajukan", oleh: "A", catatan: null }],
    });
    expect(d?.bagian[0]?.baris.map((b) => b.label)).toEqual(["Sisa", "Refund"]);
    expect(d?.bagian[0]?.baris[1]?.tautan).toEqual({ modul: "refund", id: "r1" });
    expect(d?.lampiran[0]?.thumbUrl).toBeNull(); // URL luar dibuang
    expect(d?.lampiran[0]?.url).toContain("/media/");
    expect(d?.pembayaran[0]?.aksiAlokasi.boleh).toBe(true);
    expect(d?.pembayaran[0]?.alokasi[0]?.nominal).toBe("500000.00");
    expect(d?.riwayat).toHaveLength(1);
  });

  it("opsi formulir: saldo rekening string (boleh negatif), akun pemasukan lain, karyawan", () => {
    const o = mapOpsiForm({
      kategoriPengeluaran: [{ id: "k1", code: "BBM", name: "BBM" }], kategoriPembelian: [], rekening: [{ id: "r1", name: "KEM", kind: "BANK", saldo: "-175967591.00" }],
      supplier: [{ id: "s1", code: "SUP-1", name: "CV", paymentTermDays: 14 }], akunPemasukanLain: [{ id: "a1", code: "4-9000", name: "Lain" }], karyawan: [{ id: "u1", name: "Agung" }],
      mode: [{ id: "LANGSUNG", label: "Bayar langsung" }], hanyaReimbursement: false, ambangNotaRupiah: "500000.00",
    });
    expect(o.rekening[0]?.saldo).toBe("-175967591.00");
    expect(o.supplier[0]?.paymentTermDays).toBe(14);
    expect(o.karyawan[0]?.name).toBe("Agung");
    expect(o.ambangNotaRupiah).toBe("500000.00");
  });
});

describe("isi permintaan perintah", () => {
  const nom = "1500000.00" as Money;
  it("bayar dokumen: rekening + tanggal; bayar tagihan: alokasi ke tagihan dari nilai tetap server, nominal string", () => {
    expect(bodyAksi("bayar", petaAksiTx(aksi()), { rekeningId: "r1", tanggal: "2026-09-21" })).toEqual({ cashAccountId: "r1", paidAt: "2026-09-21" });
    const tagihan = petaAksiTx(aksi({ path: "/finance/supplier-payments", tetap: { supplierId: "s1", billId: "b1" } }));
    expect(bodyAksi("bayar", tagihan, { rekeningId: "r1", nominal: nom, tanggal: "2026-09-21" })).toEqual({
      supplierId: "s1", cashAccountId: "r1", date: "2026-09-21", allocations: [{ billId: "b1", amount: "1500000.00" }],
    });
  });

  it("potong gaji membawa method tetap dari server; batalkan membawa alasan terpangkas; alokasi berisi uang string", () => {
    const potong = petaAksiTx(aksi({ path: "/finance/kasbon/k1/pelunasan", tetap: { method: "POTONG_GAJI" } }));
    expect(bodyAksi("potongGaji", potong, { nominal: nom, tanggal: "2026-09-21" })).toEqual({ method: "POTONG_GAJI", amount: "1500000.00", date: "2026-09-21" });
    expect(bodyAksi("batalkan", petaAksiTx(aksi()), { alasan: "  salah nominal  " })).toEqual({ reason: "salah nominal" });
    expect(bodyAksi("alokasi", petaAksiTx(aksi()), { alokasi: [{ orderId: "o1", amount: "400000.00" as Money }, { orderId: "o2", amount: "100000.00" as Money }] })).toEqual({
      allocations: [{ orderId: "o1", amount: "400000.00" }, { orderId: "o2", amount: "100000.00" }],
    });
    expect(bodyAksi("lampiran", petaAksiTx(aksi()), { receiptUrl: "/media/finance-receipts/a.jpg" })).toEqual({ receiptUrl: "/media/finance-receipts/a.jpg" });
  });

  it("buat dokumen: pengeluaran (draf server bila ajukan=false), kasbon, pemasukan, refund, tagihan, supplier — uang selalu string", () => {
    expect(bodyBuat({ modul: "pengeluaran", tanggal: "2026-09-21", nominal: nom, keterangan: " Servis ", kategoriId: "k1", mode: "LANGSUNG", rekeningId: "r1", ajukan: false })).toMatchObject({
      amount: "1500000.00", description: "Servis", categoryId: "k1", cashAccountId: "r1", langsungAjukan: false,
    });
    expect(bodyBuat({ modul: "kasbon", nominal: nom, karyawan: "Agung", alasan: "keluarga", rekeningId: "r1", tanggal: "2026-09-21" })).toMatchObject({ employeeName: "Agung", urgency: "keluarga", amount: "1500000.00", cashAccountId: "r1" });
    expect(bodyBuat({ modul: "pemasukan", nominal: nom, keterangan: "Bunga", akunId: "a1", rekeningId: "r1" })).toMatchObject({ accountId: "a1", cashAccountId: "r1", amount: "1500000.00" });
    expect(bodyBuat({ modul: "refund", nominal: nom, orderId: "o1", alasan: "cacat", rekeningId: "r1" })).toMatchObject({ orderId: "o1", reason: "cacat", amount: "1500000.00" });
    expect(bodyBuat({ modul: "tagihan", nominal: nom, supplierId: "s1", keterangan: "Busa", kategoriBiayaId: "k1", jatuhTempo: "2026-10-01" })).toMatchObject({ supplierId: "s1", dueDate: "2026-10-01", expenseCategoryId: "k1" });
    expect(bodyBuat({ modul: "supplier", supplierBaru: { nama: " CV Busa ", terminHari: "14" } })).toMatchObject({ name: "CV Busa", paymentTermDays: "14" });
  });

  it("izin membuat mengikuti capability, bukan nama peran", () => {
    expect(needBuat("pengeluaran")).toEqual({ need: ["financePost", "expenseSubmit"], mode: "any" });
    expect(needBuat("kasbon")).toEqual({ need: "financePost" });
  });
});

describe("guard perintah", () => {
  beforeEach(() => {
    useSession.setState({ capabilities: { financeRead: true, financePost: false, financeApprove: true, financeAdmin: false, paymentRead: true, paymentWrite: false, expenseSubmit: false, financeApp: true, preset: "APPROVER" } });
    useLock.setState({ pinSet: true, lastUnlockAt: Date.now() });
  });

  it("aksi yang tidak boleh menurut server ditolak di klien sebelum terkirim (403 dengan alasan server)", async () => {
    await expect(jalankanAksiTx("batalkan", petaAksiTx(aksi({ boleh: false, alasan: "Hanya untuk admin." })), { alasan: "x" }, "k1")).rejects.toMatchObject({ status: 403, message: "Hanya untuk admin." });
  });

  it("tanpa capability yang dibutuhkan perintah tidak jalan (penyetuju tidak boleh membayar)", async () => {
    await expect(jalankanAksiTx("bayar", petaAksiTx(aksi()), { rekeningId: "r1" }, "k1")).rejects.toThrow(/tidak punya izin/);
  });

  it("alamat asing ditolak walau server bilang boleh", async () => {
    useSession.setState({ capabilities: { financeRead: true, financePost: true, financeApprove: false, financeAdmin: true, paymentRead: true, paymentWrite: false, expenseSubmit: true, financeApp: true, preset: "OWNER" } });
    const asing = { boleh: true, alasan: null, path: "/admin/x", metode: "POST" as const, perlu: [], tetap: null };
    await expect(jalankanAksiTx("bayar", asing, {}, "k1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("aritmetika desimal formulir (BigInt, bukan Number)", () => {
  it("tambah/kurang/banding tepat pada nominal panjang dan pecahan", () => {
    expect(tambahMoney("99999999999999.99", "0.01")).toBe("100000000000000.00");
    expect(kurangMoney("500000.00", "400000.00")).toBe("100000.00");
    expect(kurangMoney("0.10", "0.30")).toBe("-0.20");
    expect(jumlahMoney(["0.10", "0.20"])).toBe("0.30"); // 0.1 + 0.2 tidak menjadi 0.30000000000000004
    expect(bandingMoney("10.00", "9.99")).toBe(1);
    expect(bandingMoney("1.5", "1.50")).toBe(0);
    expect(bandingMoney("-5.00", "1.00")).toBe(-1);
  });

  it("isian pengguna format Indonesia dibaca jadi string desimal", () => {
    expect(parseInputRupiah("1.500.000")).toBe("1500000.00");
    expect(parseInputRupiah("150.000,50")).toBe("150000.50");
    expect(parseInputRupiah("abc")).toBeNull();
  });
});
