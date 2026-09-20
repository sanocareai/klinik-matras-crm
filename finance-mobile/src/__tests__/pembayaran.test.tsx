import React from "react";
import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { mapDetail, mapHalaman, mapItem, NORMALISASI_BAYAR, putuskanBayar } from "@/api/pembayaran";
import { parseResponse } from "@/api/normalize";
import { useKeputusanBayar } from "@/features/pembayaran/useKeputusanBayar";
import { jumlahFilterBayar } from "@/features/pembayaran/FilterBayarSheet";
import type { AksiPembayaran } from "@/api/types";

jest.mock("@/api/pembayaran", () => ({ ...jest.requireActual("@/api/pembayaran"), putuskanBayar: jest.fn() }));
const putuskanMock = putuskanBayar as jest.MockedFunction<typeof putuskanBayar>;

const aksiVerif: AksiPembayaran = { boleh: true, alasan: null, path: "/finance/pembayaran/p1/verifikasi" };
const aksiTolak: AksiPembayaran = { boleh: true, alasan: null, path: "/finance/pembayaran/p1/tolak", alasanWajib: true };

// Bentuk PERSIS seperti yang dikirim server (backend/src/services/finance/pembayaran.js#normalisasi): uang = string desimal, hitungan = angka.
const rawItem = {
  id: "p1", status: "MENUNGGU", statusLabel: "Menunggu verifikasi", nominal: "1500000.00", metode: "TRANSFER", metodeLabel: "Transfer", jenis: "DP",
  dicatatPada: "2026-09-20T03:00:00.000Z", tanggal: "2026-09-20",
  order: { id: "o1", nomor: "SAN-S5-0001", nilai: "5000000.00", statusBayar: "BELUM_BAYAR" }, pelanggan: { id: "c1", name: "Ibu Erni" },
  rekening: { id: "r1", name: "SANOBANK Kemal" }, pencatat: { id: "u1", name: "Risel" }, sumber: "CRM", adaBukti: true, adaAlokasi: false,
  verifikasi: null, pembatalan: null,
  aksi: {
    verifikasi: { boleh: true, alasan: null, path: "/finance/pembayaran/p1/verifikasi", metode: "POST" },
    tolak: { boleh: true, alasan: null, alasanWajib: true, path: "/finance/pembayaran/p1/tolak", metode: "POST" },
  },
};
const muat = (o: unknown) => parseResponse(JSON.stringify(o), NORMALISASI_BAYAR);
const ringkasBaris = (jumlah: number, nominal: string) => ({ jumlah, nominal });

describe("pemetaan API pembayaran", () => {
  it("uang tetap string desimal (tanpa float); hitungan tetap number; 14 digit + 2 desimal tidak rusak", () => {
    const teks = JSON.stringify({
      items: [{ ...rawItem, nominal: "1.00" }], nextCursor: "abc", hitung: { MENUNGGU: 22, TERVERIFIKASI: 3, DITOLAK: 2, DIBATALKAN: 1 },
      ringkasan: { menunggu: ringkasBaris(22, "1.00"), terverifikasi: ringkasBaris(3, "2.00"), ditolak: ringkasBaris(2, "3.00"), dibatalkan: ringkasBaris(1, "4.00"), totalMasuk: "5.00" },
      diperbaruiPada: "2026-09-20T05:00:00.000Z",
    }).replace('"nominal":"1.00","metode"', '"nominal":"98765432109876.54","metode"');
    const h = mapHalaman(parseResponse(teks, NORMALISASI_BAYAR));
    expect(h.items[0]?.nominal).toBe("98765432109876.54");
    expect(h.hitung).toEqual({ MENUNGGU: 22, TERVERIFIKASI: 3, DITOLAK: 2, DIBATALKAN: 1 });
    expect(typeof h.hitung.MENUNGGU).toBe("number");
    expect(h.ringkasan.menunggu).toEqual({ jumlah: 22, nominal: "1.00" });
    expect(h.ringkasan.totalMasuk).toBe("5.00");
    expect(h.nextCursor).toBe("abc");
  });

  it("bila server suatu saat mengirim uang sebagai ANGKA JSON, klien tetap membacanya lossless sebagai string", () => {
    const teks = JSON.stringify({ items: [rawItem] }).replace('"nominal":"1500000.00"', '"nominal":98765432109876.54');
    expect(mapHalaman(parseResponse(teks, NORMALISASI_BAYAR)).items[0]?.nominal).toBe("98765432109876.54");
  });

  it("item cacat dibuang (status asing, nominal bukan angka, tanpa id), sisanya dipertahankan; payload rusak tidak melempar", () => {
    const h = mapHalaman(muat({ items: [rawItem, { ...rawItem, id: "x", status: "APA_ITU" }, { ...rawItem, id: "y", nominal: "abc" }, { ...rawItem, id: undefined }, null, 5], hitung: null }));
    expect(h.items.map((i) => i.id)).toEqual(["p1"]);
    expect(h.hitung).toEqual({ MENUNGGU: 0, TERVERIFIKASI: 0, DITOLAK: 0, DIBATALKAN: 0 });
    expect(h.ringkasan.totalMasuk).toBe("0.00");
    expect(() => mapHalaman(null)).not.toThrow();
    expect(mapHalaman("bukan objek").items).toEqual([]);
  });

  it("aksi fail-closed: tanpa path / path di luar /finance/pembayaran/ / boleh bukan true → tidak boleh", () => {
    const uji = (aksi: unknown) => mapItem(muat({ ...rawItem, aksi: { verifikasi: aksi, tolak: aksi } }))?.aksi.verifikasi;
    expect(uji({ boleh: true, path: "/finance/pembayaran/p1/verifikasi" })?.boleh).toBe(true);
    expect(uji({ boleh: true })?.boleh).toBe(false);
    expect(uji({ boleh: true, path: "https://jahat.example/x" })?.boleh).toBe(false);
    expect(uji({ boleh: true, path: "/finance/expenses/e1/approve" })?.boleh).toBe(false);
    expect(uji({ boleh: true, path: "/mobile/auth/logout" })?.boleh).toBe(false);
    expect(uji({ boleh: "true", path: "/finance/pembayaran/p1/verifikasi" })?.boleh).toBe(false);
    expect(uji(undefined)?.alasan).toBe("Tidak tersedia.");
    expect(uji({ boleh: false, alasan: "Akun Anda tidak punya izin memverifikasi pembayaran.", path: "/finance/pembayaran/p1/verifikasi" })?.alasan).toMatch(/tidak punya izin/);
  });

  it("jenis di luar DP/CICILAN/PELUNASAN menjadi null; pembayaran tanpa order tetap terbaca", () => {
    const i = mapItem(muat({ ...rawItem, jenis: "ANEH", order: null, pelanggan: null }));
    expect(i?.jenis).toBeNull();
    expect(i?.order).toBeNull();
    expect(i?.pelanggan).toBeNull();
  });

  it("detail: tagihan (sisa bisa negatif), alokasi, jurnal, belum dibukukan, field yang tak tercatat, peringatan, riwayat", () => {
    const d = mapDetail(muat({
      ...rawItem,
      tagihan: { nilaiOrder: "5000000.00", terbayarTerhitung: "1500000.00", sisa: "3500000.00", sisaSetelahIni: "-100000.00", gerbangVerifikasi: true, terhitungSebelumVerifikasi: true },
      invoice: { nomor: "INV-20092026-001", status: "SENT", jatuhTempo: "2026-10-01" }, statusOrder: "DELIVERED",
      alokasi: [{ orderId: "o1", nomor: "SAN-S5-0001", nominal: "500000.00", catatan: null }, { orderId: "o2", nomor: null, nominal: "abc", catatan: null }],
      jurnal: { nomor: "JU-00001", status: "POSTED", tanggal: "2026-09-20" }, belumDibukukan: { pesan: "Belum masuk buku besar." },
      bukti: null, tidakTercatat: ["referensi", "pengirim", "catatan", 5],
      peringatan: [{ kode: "TANPA_BUKTI", pesan: "Belum ada bukti pembayaran terlampir." }, { kode: "X" }],
      riwayat: [{ waktu: "2026-09-20T03:00:00.000Z", peristiwa: "DICATAT", label: "Dicatat", oleh: "Risel", catatan: null }, { bukan: "riwayat" }],
    }));
    expect(d?.tagihan).toMatchObject({ nilaiOrder: "5000000.00", sisa: "3500000.00", sisaSetelahIni: "-100000.00", gerbangVerifikasi: true, terhitungSebelumVerifikasi: true });
    expect(d?.invoice).toEqual({ nomor: "INV-20092026-001", status: "SENT", jatuhTempo: "2026-10-01" });
    expect(d?.alokasi).toEqual([{ orderId: "o1", nomor: "SAN-S5-0001", nominal: "500000.00", catatan: null }]); // nominal bukan angka → dibuang
    expect(d?.jurnal).toEqual({ nomor: "JU-00001", status: "POSTED", tanggal: "2026-09-20" });
    expect(d?.belumDibukukan?.pesan).toBe("Belum masuk buku besar.");
    expect(d?.tidakTercatat).toEqual(["referensi", "pengirim", "catatan"]);
    expect(d?.peringatan).toEqual([{ kode: "TANPA_BUKTI", pesan: "Belum ada bukti pembayaran terlampir." }]);
    expect(d?.riwayat).toHaveLength(1);
  });

  it("bukti: gambar/PDF hanya jalur milik server; URL luar dibuang menjadi 'tautan'", () => {
    const bukti = (b: unknown) => mapDetail(muat({ ...rawItem, bukti: b }))?.bukti;
    expect(bukti({ jenis: "gambar", url: "/media/finance-receipts/a.jpg?exp=1&sig=ab", thumbUrl: "/media/finance-receipts/a_t.jpg?exp=1&sig=cd", kedaluwarsa: "2026-09-20T05:10:00.000Z" }))
      .toMatchObject({ jenis: "gambar", url: "/media/finance-receipts/a.jpg?exp=1&sig=ab", thumbUrl: "/media/finance-receipts/a_t.jpg?exp=1&sig=cd" });
    expect(bukti({ jenis: "pdf", url: "/media/bukti-pembayaran/b.pdf?exp=1&sig=ab", thumbUrl: null, kedaluwarsa: null })).toMatchObject({ jenis: "pdf", url: "/media/bukti-pembayaran/b.pdf?exp=1&sig=ab" });
    expect(bukti({ jenis: "gambar", url: "/api/finance/media/payment-proofs/c.png?exp=1&sig=ab", thumbUrl: null, kedaluwarsa: null })?.jenis).toBe("gambar");
    expect(bukti({ jenis: "gambar", url: "https://jahat.example/x.jpg", thumbUrl: "http://jahat.example/x_t.jpg", kedaluwarsa: null })).toEqual({ jenis: "tautan", url: null, thumbUrl: null, kedaluwarsa: null });
    expect(bukti({ jenis: "tautan", url: null, thumbUrl: null, kedaluwarsa: null })?.jenis).toBe("tautan");
    expect(bukti("bukan objek")).toBeNull();
  });
});

describe("useKeputusanBayar: double-tap, kunci idempotensi, muat ulang", () => {
  function pasang() {
    const qc = new QueryClient();
    const spy = jest.spyOn(qc, "invalidateQueries");
    const hook = renderHook(() => useKeputusanBayar(), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    return { ...hook, spy };
  }
  beforeEach(() => putuskanMock.mockReset());

  it("dua tap bersamaan → hanya SATU perintah terkirim; yang kedua ditolak lokal", async () => {
    putuskanMock.mockImplementation(() => new Promise((r) => setTimeout(r, 25)));
    const { result } = pasang();
    let hasil: Awaited<ReturnType<typeof result.current.kirim>>[] = [];
    await act(async () => { hasil = await Promise.all([result.current.kirim("p1", "verifikasi", aksiVerif), result.current.kirim("p1", "verifikasi", aksiVerif)]); });
    expect(putuskanMock).toHaveBeenCalledTimes(1);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
  });

  it("sukses → daftar, detail, lencana, dan dashboard diambil ulang dari server", async () => {
    putuskanMock.mockResolvedValue(undefined);
    const { result, spy } = pasang();
    await act(async () => { await result.current.kirim("p1", "tolak", aksiTolak, "uang belum masuk"); });
    expect(putuskanMock).toHaveBeenCalledWith(expect.objectContaining({ alasan: "uang belum masuk", aksi: aksiTolak }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["pembayaran"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("hasil tidak pasti → percobaan ulang memakai Idempotency-Key SAMA; setelah galat pasti (409) kunci baru", async () => {
    const { result } = pasang();
    putuskanMock.mockRejectedValueOnce(new ApiError({ status: 0, code: "NETWORK", message: "putus", tidakPasti: true }));
    putuskanMock.mockRejectedValueOnce(new ApiError({ status: 409, code: "SUDAH_DIPROSES", message: "Pembayaran ini sudah diverifikasi oleh Finance Lain." }));
    putuskanMock.mockResolvedValueOnce(undefined);
    let h1; let h2; let h3;
    await act(async () => { h1 = await result.current.kirim("p1", "verifikasi", aksiVerif); });
    await act(async () => { h2 = await result.current.kirim("p1", "verifikasi", aksiVerif); });
    await act(async () => { h3 = await result.current.kirim("p1", "verifikasi", aksiVerif); });
    const kunci = putuskanMock.mock.calls.map((c) => c[0].kunci);
    expect(kunci[0]).toBe(kunci[1]);
    expect(kunci[2]).not.toBe(kunci[1]);
    expect(h1).toMatchObject({ ok: false, info: { jenis: "tidakPasti", muatUlang: true } });
    expect(h2).toMatchObject({ ok: false, info: { jenis: "konflik" } });
    expect(h3).toMatchObject({ ok: true });
  });

  it("409 menampilkan pesan server ('sudah diverifikasi oleh …') + status dimuat ulang; galat lain tidak membocorkan pesan teknis", async () => {
    const { result } = pasang();
    putuskanMock.mockRejectedValueOnce(new ApiError({ status: 409, code: "SUDAH_DIPROSES", message: "Pembayaran ini sudah diverifikasi oleh Finance Lain." }));
    putuskanMock.mockRejectedValueOnce(new ApiError({ status: 500, code: "INTERNAL", message: "stack trace rahasia" }));
    let h1: Awaited<ReturnType<typeof result.current.kirim>> | undefined;
    let h2: Awaited<ReturnType<typeof result.current.kirim>> | undefined;
    await act(async () => { h1 = await result.current.kirim("p1", "verifikasi", aksiVerif); });
    await act(async () => { h2 = await result.current.kirim("p2", "verifikasi", aksiVerif); });
    const pesanDari = (h: typeof h1) => (h && !h.ok ? h.info.pesan : "");
    expect(h1).toMatchObject({ ok: false, info: { jenis: "konflik" } });
    expect(pesanDari(h1)).toMatch(/sudah diverifikasi oleh Finance Lain\. Status terbaru dimuat ulang\./);
    expect(h2).toMatchObject({ ok: false, info: { jenis: "server" } });
    expect(pesanDari(h2)).not.toMatch(/stack trace/);
  });

  it("dokumen atau jenis aksi berbeda tidak memakai kunci yang sama", async () => {
    putuskanMock.mockRejectedValue(new ApiError({ status: 500, code: "INTERNAL", message: "x" }));
    const { result } = pasang();
    await act(async () => { await result.current.kirim("p1", "verifikasi", aksiVerif); });
    await act(async () => { await result.current.kirim("p2", "verifikasi", aksiVerif); });
    await act(async () => { await result.current.kirim("p2", "tolak", aksiTolak, "x"); });
    expect(new Set(putuskanMock.mock.calls.map((c) => c[0].kunci)).size).toBe(3);
  });

  it("izin dicabut (403) → menyegarkan hak akses dari server", async () => {
    putuskanMock.mockRejectedValue(new ApiError({ status: 403, code: "FORBIDDEN", message: "x" }));
    const { result } = pasang();
    let h; await act(async () => { h = await result.current.kirim("p1", "verifikasi", aksiVerif); });
    expect(h).toMatchObject({ ok: false, info: { jenis: "izin", segarkanIzin: true } });
  });
});

describe("util filter", () => {
  it("jumlah filter aktif: cara bayar, rekening, periode", () => {
    expect(jumlahFilterBayar({ metode: null, rekeningId: null, from: null })).toBe(0);
    expect(jumlahFilterBayar({ metode: "CASH", rekeningId: "r1", from: "2026-09-01" })).toBe(3);
  });
});
