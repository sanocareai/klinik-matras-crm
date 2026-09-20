import React from "react";
import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { mapDetail, mapHalaman, mapItem, NORMALISASI_APPROVAL, putuskan } from "@/api/approvals";
import { parseResponse } from "@/api/normalize";
import { klasifikasiKeputusan } from "@/features/persetujuan/galat";
import { labelUmur } from "@/features/persetujuan/KartuItem";
import { jumlahFilterAktif, periodeKeRentang } from "@/features/persetujuan/Sheets";
import { useKeputusan } from "@/features/persetujuan/useKeputusan";
import { AksesDitolak } from "@/auth/capabilities";
import { StepUpDibatalkan } from "@/api/command";
import type { AksiKeputusan } from "@/api/types";

jest.mock("@/api/approvals", () => ({ ...jest.requireActual("@/api/approvals"), putuskan: jest.fn() }));
const putuskanMock = putuskan as jest.MockedFunction<typeof putuskan>;

const aksiSetuju: AksiKeputusan = { boleh: true, alasan: null, path: "/finance/expenses/abc/approve" };
const aksiTolak: AksiKeputusan = { boleh: true, alasan: null, path: "/finance/expenses/abc/reject", alasanWajib: true };

// Bentuk PERSIS seperti yang dikirim server (backend/src/services/finance/approvals.js): uang & hitungan sama-sama angka JSON.
const rawItem = {
  kunci: "expense:abc", id: "abc", jenis: "expense", jenisLabel: "Pengeluaran", nomor: "EXP-15092026-001", tanggal: "2026-09-15",
  diajukanPada: "2026-09-14T03:00:00.000Z", umurHari: 6, pemohon: { id: "u1", name: "Imam" }, nominal: 1250000, keterangan: "Upah lembur",
  kategori: "Upah produksi", rekening: "Kas Kantor", pihak: "Tukang harian", nomorOrder: null, mode: "REIMBURSEMENT", status: "MENUNGGU_APPROVAL",
  statusLabel: "Menunggu persetujuan", tahap: "MENUNGGU", adaLampiran: true, alasanTolak: null, diputuskanOleh: null, diputuskanPada: null, syarat: null,
  aksi: {
    setujui: { boleh: true, alasan: null, path: "/finance/expenses/abc/approve", metode: "POST" },
    tolak: { boleh: true, alasan: null, alasanWajib: true, path: "/finance/expenses/abc/reject", metode: "POST" },
  },
};
const muat = (o: unknown) => parseResponse(JSON.stringify(o), NORMALISASI_APPROVAL);

describe("pemetaan API inbox persetujuan", () => {
  it("nominal → string desimal (tanpa float); hitungan tetap number (total/umur/halaman)", () => {
    // Teks JSON ditulis manual: 14 digit + 2 desimal tidak bisa dipegang float JS (itulah alasan klien membaca lossless).
    const teks = JSON.stringify({
      items: [{ ...rawItem, nominal: 1 }], tab: "MENUNGGU", page: 2, limit: 20, total: 41, adaLagi: true,
      hitung: { MENUNGGU: 41, DIPROSES: 3, DISETUJUI: 120, DITOLAK: 7 },
    }).replace('"nominal":1,', '"nominal":98765432109876.54,');
    const h = mapHalaman(parseResponse(teks, NORMALISASI_APPROVAL));
    expect(h.items[0]?.nominal).toBe("98765432109876.54");
    expect(typeof h.total).toBe("number");
    expect(h.total).toBe(41);
    expect(h.page).toBe(2);
    expect(h.adaLagi).toBe(true);
    expect(h.hitung).toEqual({ MENUNGGU: 41, DIPROSES: 3, DISETUJUI: 120, DITOLAK: 7 });
    expect(h.items[0]?.umurHari).toBe(6);
    expect(muat(rawItem)).toMatchObject({ nominal: "1250000.00" });
  });

  it("item cacat dibuang (jenis/tahap asing, nominal bukan angka), sisanya dipertahankan; payload rusak tidak melempar", () => {
    const h = mapHalaman(muat({
      items: [rawItem, { ...rawItem, id: "x", jenis: "kasbon" }, { ...rawItem, id: "y", tahap: "APA_ITU" }, { ...rawItem, id: "z", nominal: "abc" }, null, 5],
      hitung: null, total: 1,
    }));
    expect(h.items.map((i) => i.id)).toEqual(["abc"]);
    expect(h.hitung).toEqual({ MENUNGGU: 0, DIPROSES: 0, DISETUJUI: 0, DITOLAK: 0 });
    expect(() => mapHalaman(null)).not.toThrow();
    expect(mapHalaman("bukan objek").items).toEqual([]);
  });

  it("aksi fail-closed: tanpa path / path di luar /finance/ / boleh bukan true → tidak boleh", () => {
    const uji = (aksi: unknown) => mapItem(muat({ ...rawItem, aksi: { setujui: aksi, tolak: aksi } }))?.aksi.setujui;
    expect(uji({ boleh: true, path: "/finance/expenses/abc/approve" })?.boleh).toBe(true);
    expect(uji({ boleh: true })?.boleh).toBe(false);
    expect(uji({ boleh: true, path: "https://jahat.example/approve" })?.boleh).toBe(false);
    expect(uji({ boleh: true, path: "/mobile/auth/logout" })?.boleh).toBe(false);
    expect(uji({ boleh: "true", path: "/finance/x" })?.boleh).toBe(false);
    expect(uji(undefined)?.alasan).toBe("Tidak tersedia.");
    expect(uji({ boleh: false, alasan: "Pengajuan Anda sendiri harus disetujui orang lain.", path: "/finance/expenses/abc/approve" })?.alasan).toMatch(/orang lain/);
  });

  it("detail: lampiran hanya jalur /media/ milik server; URL luar dibuang; riwayat & rincian terpetakan", () => {
    const d = mapDetail(muat({
      ...rawItem, syarat: { terpenuhi: false, pesan: "Wajib foto nota" },
      rincian: { divisi: "PRODUKSI", buktiTerverifikasi: false, aneh: { a: 1 } },
      lampiran: [
        { id: "f1.jpg", jenis: "foto", url: "/media/finance-receipts/f1.jpg?exp=1&sig=ab", thumbUrl: "/media/finance-receipts/f1_t.jpg?exp=1&sig=cd", kedaluwarsa: "2026-09-20T05:10:00.000Z" },
        { id: "luar", jenis: "foto", url: "https://jahat.example/x.jpg", thumbUrl: "http://jahat.example/x_t.jpg", kedaluwarsa: null },
        { id: "pdf", jenis: "tautan", url: null, thumbUrl: null, kedaluwarsa: null },
      ],
      riwayat: [{ waktu: "2026-09-14T03:00:00.000Z", peristiwa: "DIAJUKAN", label: "Diajukan", oleh: "Imam", catatan: null }, { bukan: "riwayat" }],
    }));
    expect(d?.lampiran.map((l) => [l.id, l.url != null])).toEqual([["f1.jpg", true], ["luar", false], ["pdf", false]]);
    expect(d?.lampiran[1]?.thumbUrl).toBeNull();
    expect(d?.riwayat).toHaveLength(1);
    expect(d?.rincian).toEqual({ divisi: "PRODUKSI", buktiTerverifikasi: false });
    expect(d?.syarat?.pesan).toBe("Wajib foto nota");
  });
});

describe("klasifikasi galat keputusan → teks Indonesia", () => {
  const e = (status: number, code = "X", extra: object = {}) => new ApiError({ status, code, message: "pesan server", ...extra });

  it("step-up dibatalkan diam; akses ditolak klien; 409 konflik memuat ulang; 403 menyegarkan izin", () => {
    expect(klasifikasiKeputusan(new StepUpDibatalkan()).jenis).toBe("batal");
    expect(klasifikasiKeputusan(new AksesDitolak("financeApprove"))).toMatchObject({ jenis: "izin", segarkanIzin: true });
    expect(klasifikasiKeputusan(e(409))).toMatchObject({ jenis: "konflik", muatUlang: true, simpanKunci: false });
    expect(klasifikasiKeputusan(e(409)).pesan).toMatch(/sudah diproses pengguna lain/);
    expect(klasifikasiKeputusan(e(403))).toMatchObject({ jenis: "izin", segarkanIzin: true, muatUlang: true });
    expect(klasifikasiKeputusan(e(403)).pesan).toMatch(/Izin Anda berubah/);
  });

  it("validasi (400/422) menampilkan pesan aturan bisnis apa adanya; 5xx & jaringan generik; hasil tidak pasti mempertahankan kunci", () => {
    expect(klasifikasiKeputusan(e(400))).toMatchObject({ jenis: "validasi", pesan: "pesan server" });
    expect(klasifikasiKeputusan(e(422))).toMatchObject({ jenis: "validasi", pesan: "pesan server", muatUlang: true });
    const s5 = klasifikasiKeputusan(e(500, "INTERNAL"));
    expect(s5.jenis).toBe("server");
    expect(s5.pesan).not.toContain("pesan server");
    expect(s5.simpanKunci).toBe(true);
    const putus = klasifikasiKeputusan(e(0, "NETWORK", { tidakPasti: true }));
    expect(putus).toMatchObject({ jenis: "tidakPasti", simpanKunci: true, muatUlang: true });
    expect(klasifikasiKeputusan(e(0, "NETWORK")).jenis).toBe("jaringan");
    expect(klasifikasiKeputusan(new Error("aneh")).jenis).toBe("lain");
  });
});

describe("useKeputusan: double-tap, kunci idempotensi, muat ulang", () => {
  function pasang() {
    const qc = new QueryClient();
    const spy = jest.spyOn(qc, "invalidateQueries");
    const hook = renderHook(() => useKeputusan(), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    return { ...hook, spy };
  }
  beforeEach(() => putuskanMock.mockReset());

  it("dua tap bersamaan → hanya SATU perintah terkirim; yang kedua ditolak lokal", async () => {
    putuskanMock.mockImplementation(() => new Promise((r) => setTimeout(r, 25)));
    const { result } = pasang();
    let hasil: Awaited<ReturnType<typeof result.current.kirim>>[] = [];
    await act(async () => {
      hasil = await Promise.all([result.current.kirim("abc", "setujui", aksiSetuju), result.current.kirim("abc", "setujui", aksiSetuju)]);
    });
    expect(putuskanMock).toHaveBeenCalledTimes(1);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
  });

  it("sukses → semua data persetujuan & dashboard diambil ulang dari server", async () => {
    putuskanMock.mockResolvedValue(undefined);
    const { result, spy } = pasang();
    await act(async () => { await result.current.kirim("abc", "tolak", aksiTolak, "nota buram"); });
    expect(putuskanMock).toHaveBeenCalledWith(expect.objectContaining({ alasan: "nota buram", aksi: aksiTolak }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["approvals"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("hasil tidak pasti → percobaan ulang memakai Idempotency-Key SAMA; setelah galat pasti (409) kunci baru", async () => {
    const { result } = pasang();
    putuskanMock.mockRejectedValueOnce(new ApiError({ status: 0, code: "NETWORK", message: "putus", tidakPasti: true }));
    putuskanMock.mockRejectedValueOnce(new ApiError({ status: 409, code: "CONFLICT", message: "sudah" }));
    putuskanMock.mockResolvedValueOnce(undefined);
    let h1; let h2; let h3;
    await act(async () => { h1 = await result.current.kirim("abc", "setujui", aksiSetuju); });
    await act(async () => { h2 = await result.current.kirim("abc", "setujui", aksiSetuju); });
    await act(async () => { h3 = await result.current.kirim("abc", "setujui", aksiSetuju); });
    const kunci = putuskanMock.mock.calls.map((c) => c[0].kunci);
    expect(kunci[0]).toBe(kunci[1]);
    expect(kunci[2]).not.toBe(kunci[1]);
    expect(h1).toMatchObject({ ok: false, info: { jenis: "tidakPasti" } });
    expect(h2).toMatchObject({ ok: false, info: { jenis: "konflik" } });
    expect(h3).toMatchObject({ ok: true });
  });

  it("dokumen atau jenis aksi berbeda tidak memakai kunci yang sama", async () => {
    putuskanMock.mockRejectedValue(new ApiError({ status: 500, code: "INTERNAL", message: "x" }));
    const { result } = pasang();
    await act(async () => { await result.current.kirim("abc", "setujui", aksiSetuju); });
    await act(async () => { await result.current.kirim("lain", "setujui", aksiSetuju); });
    await act(async () => { await result.current.kirim("lain", "tolak", aksiTolak, "x"); });
    const kunci = putuskanMock.mock.calls.map((c) => c[0].kunci);
    expect(new Set(kunci).size).toBe(3);
  });

  it("izin dicabut (403) → menyegarkan hak akses dari server", async () => {
    putuskanMock.mockRejectedValue(new ApiError({ status: 403, code: "FORBIDDEN", message: "x" }));
    const { result } = pasang();
    let h; await act(async () => { h = await result.current.kirim("abc", "setujui", aksiSetuju); });
    expect(h).toMatchObject({ ok: false, info: { jenis: "izin", segarkanIzin: true } });
  });
});

describe("util tampilan inbox", () => {
  it("umur, filter aktif, periode → rentang tanggal", () => {
    expect(labelUmur(0)).toBe("Hari ini");
    expect(labelUmur(1)).toBe("Kemarin");
    expect(labelUmur(6)).toBe("6 hari");
    expect(jumlahFilterAktif({ jenis: [], from: null, pemohonId: null })).toBe(0);
    expect(jumlahFilterAktif({ jenis: ["bill"], from: "2026-09-01", pemohonId: "u1" })).toBe(3);
    expect(periodeKeRentang(null)).toEqual({ from: null, to: null });
    expect(periodeKeRentang("tidak-ada")).toEqual({ from: null, to: null });
    const r = periodeKeRentang("bulan-ini");
    expect(r.from).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe("putuskan (asli): aksi tidak boleh tidak dikirim", () => {
  it("aksi.boleh=false ditolak di klien tanpa memanggil jaringan", async () => {
    const asli = jest.requireActual("@/api/approvals") as typeof import("@/api/approvals");
    await expect(asli.putuskan({ aksi: { boleh: false, alasan: "Sudah diputuskan.", path: "/finance/expenses/abc/approve" }, kunci: "k" })).rejects.toMatchObject({ status: 403 });
  });
});
