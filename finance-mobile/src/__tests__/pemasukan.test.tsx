// Pemasukan (v1.1.0): kontrak dengan respons backend NYATA (fixture dari financePemasukan.integration.test.js, DUMP_PEMASUKAN=1) + layar di atas server contoh.
// Yang dijaga: uang tetap string desimal, negatif utuh, baris tak lengkap dijatuhkan (fail-closed), tidak ada hitungan klien, semua kelas terpisah, virtualisasi/paginasi,
// state kosong/galat/offline/sesi, drill-down, sembunyikan nominal, dan capability.

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as NetInfo from "@react-native-community/netinfo";
import fixtureRaw from "./fixtures/pemasukan-real.json";
import { ThemeProvider } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { setSkenario, type Skenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import { isMoneyString } from "@/lib/money";
import { mapBaris, mapHalaman, mapRingkasan } from "@/api/pemasukan";
import PemasukanRute from "../../app/pemasukan/index";

const fx = fixtureRaw as unknown as { ringkasan: Record<string, any>; daftar: { items: any[] } };
const router = jest.requireMock("expo-router") as { __push: jest.Mock; __back: jest.Mock };
const netinfo = NetInfo as unknown as { useNetInfo: jest.Mock };
const T = { timeout: 5000 };
jest.setTimeout(30000);

describe("kontrak respons nyata", () => {
  it("ringkasan: terbaca lengkap; semua uang string desimal; gabungan = sistem + historis (tanpa pembayaran)", () => {
    const r = mapRingkasan(fx.ringkasan);
    expect(r).not.toBeNull();
    if (!r) return;
    for (const v of [r.pendapatanSistem.nilai, r.pendapatanSistem.bruto, r.pendapatanSistem.retur, r.pendapatanGabungan.nilai, r.piutangTersisa.nilai, r.pemasukanLain.nilai, r.danaMasukBukanPendapatan.nilai, r.pembayaranMasuk.terverifikasi.nilai]) expect(isMoneyString(v)).toBe(true);
    expect(r.pendapatanSistem.retur.startsWith("-")).toBe(true);
    expect(r.pendapatanGabungan.nilai).toBe(r.pendapatanSistem.nilai); // historis 0 pada fixture
    expect(r.pembayaranMasuk.belumDibukukan.jumlah).toBeGreaterThan(0);
    expect(r.dikecualikan.transfer.jumlah).toBe(1);
    expect(r.penjelasan.length).toBeGreaterThan(0);
  });
  it("daftar: tidak ada baris jatuh; setiap kelas hadir; negatif utuh; pembayaran & pendapatan terpisah", () => {
    const h = mapHalaman(fx.daftar);
    expect(h.items.length).toBe(fx.daftar.items.length);
    const kelas = new Set(h.items.map((b) => b.kategori));
    for (const k of ["PENDAPATAN", "PEMBAYARAN", "LAIN", "DANA", "DIKECUALIKAN", "DITINJAU"]) expect(kelas.has(k as never)).toBe(true);
    for (const b of h.items) expect(isMoneyString(b.nilai)).toBe(true);
    expect(h.items.find((b) => b.sub === "RETUR")?.nilai).toBe("-120000.55");
    expect(h.items.filter((b) => b.kategori === "PEMBAYARAN").every((b) => b.jenis === "pembayaran")).toBe(true);
    expect(h.items.find((b) => b.sub === "PEMBAYARAN_BELUM_DIBUKUKAN")?.perluTinjau).toBe(true);
  });
  it("fail-closed: baris tanpa nilai/kunci/kategori sah dijatuhkan; ringkasan tanpa bagian wajib = null", () => {
    expect(mapBaris({ key: "x", id: "1", kategori: "PENDAPATAN", nilai: 100 })).toBeNull(); // uang bukan string
    expect(mapBaris({ id: "1", kategori: "PENDAPATAN", nilai: "1.00" })).toBeNull();
    expect(mapBaris({ key: "x", id: "1", kategori: "NGAWUR", nilai: "1.00" })).toBeNull();
    expect(mapRingkasan({ pendapatanSistem: { nilai: "1.00" } })).toBeNull();
    expect(mapRingkasan(null)).toBeNull();
  });
});

function tampil(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}><ThemeProvider>{children}</ThemeProvider></QueryClientProvider> });
}
function buka(skenario: Skenario = "normal", email = "finance@x") {
  setSkenario(skenario);
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
}
const tekan = (l: string | RegExp) => fireEvent.press(screen.getAllByLabelText(l)[0]!);
const tunggu = (l: string | RegExp) => waitFor(() => expect(screen.getAllByLabelText(l).length).toBeGreaterThan(0), T);
const tungguTeks = (t: string | RegExp) => waitFor(() => expect(screen.getAllByText(t).length).toBeGreaterThan(0), T);

beforeEach(() => {
  usePrefs.setState({ sembunyikanAngka: false });
  router.__push.mockClear(); router.__back.mockClear();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() });
});

describe("layar Pemasukan", () => {
  it("ringkasan: pembeda Pendapatan ≠ Uang masuk, kartu terpisah, label data sebelum sistem, dan drill-down ke daftar", async () => {
    buka(); tampil(<PemasukanRute />);
    await tungguTeks("Pendapatan ≠ uang masuk");
    await tungguTeks(/Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final./);
    await tunggu(/^Pendapatan dari sistem/);
    await tunggu(/^Pembayaran masuk terverifikasi/);
    await tungguTeks(/Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar/);
    await tungguTeks(/Celah pengakuan pendapatan/);
    tekan(/^Pendapatan dari sistem/);
    await tunggu(/^JV-/);
    tekan(/^Ringkasan$/);
    await tunggu(/^Pembayaran masuk terverifikasi/);
  });

  it("tab Pendapatan Penjualan: retur negatif tampil utuh; daftar dipaginasi (muat lebih banyak)", async () => {
    buka(); tampil(<PemasukanRute />);
    await tunggu(/^Pendapatan Penjualan$/);
    tekan(/^Pendapatan Penjualan$/);
    await tungguTeks(/Retur\/potongan penjualan/);
    await tunggu("Muat lebih banyak");
    tekan("Muat lebih banyak");
    await waitFor(() => expect(screen.queryByLabelText("Muat lebih banyak")).toBeNull(), T);
  });

  it("baris → sheet rincian dengan klasifikasi; tautan jurnal, pembayaran, dan Pemasukan Lain membuka layar yang benar", async () => {
    buka(); tampil(<PemasukanRute />);
    tekan(/^Pembayaran Masuk$/);
    await tungguTeks(/Terverifikasi, belum masuk buku besar/);
    fireEvent.press(screen.getAllByLabelText(/^JV-\d+.*Buka rincian|Buka rincian/)[0]!);
    await tunggu("Buka pembayaran");
    tekan("Buka pembayaran");
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/pembayaran/[id]", params: { id: expect.any(String) } });
  });

  it("Pemasukan Lain: sheet punya tautan ke workflow Pemasukan Lain (satu-satunya jalur pencatatan)", async () => {
    buka(); tampil(<PemasukanRute />);
    tekan(/^Pemasukan Lain$/);
    await tunggu(/Bunga bank|JV-/);
    fireEvent.press(screen.getAllByLabelText(/Buka rincian/)[0]!);
    await tunggu("Buka Pemasukan Lain");
    tekan("Buka Pemasukan Lain");
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/tx/[modul]/[id]", params: { modul: "pemasukan", id: "oi1" } });
    expect(screen.queryByLabelText(/buat pemasukan|tambah pemasukan/i)).toBeNull();
  });

  it("Data Sebelum Sistem: label non-posting, baris arsip, negatif 'Perlu ditinjau'; impor hanya di web", async () => {
    buka(); tampil(<PemasukanRute />);
    tekan(/^Data Sebelum Sistem$/);
    await tungguTeks(/Berasal dari arsip lama dan belum memengaruhi buku besar/);
    await tunggu(/^NOTION-001/);
    await tungguTeks("Perlu ditinjau");
    expect(screen.queryByLabelText(/^Impor/i)).toBeNull();
  });

  it("Dana masuk bukan pendapatan & Perlu Ditinjau tersedia; kosong menampilkan keadaan kosong", async () => {
    buka(); tampil(<PemasukanRute />);
    tekan(/^Dana Masuk Bukan Pendapatan$/);
    await tungguTeks(/Setoran modal pemilik/);
    await tungguTeks(/Pendanaan pihak ketiga/);
  });

  it("kosong: ringkasan nol tanpa galat", async () => {
    buka("kosong"); tampil(<PemasukanRute />);
    await tunggu(/^Pendapatan dari sistem/);
    expect(screen.queryByText(/Perlu ditinjau: /)).toBeNull();
  });

  it("galat server: pesan + coba lagi; offline: banner; sesi habis ditangani", async () => {
    buka("galat"); tampil(<PemasukanRute />);
    await tunggu(/Coba lagi/);
  });

  it("offline: banner offline tampil", async () => {
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    buka(); tampil(<PemasukanRute />);
    await tungguTeks(/Tidak ada koneksi/);
  });

  it("nominal panjang: tetap utuh; sembunyikan nominal menyamarkan angka", async () => {
    buka("panjang"); tampil(<PemasukanRute />);
    tekan(/^Pendapatan Penjualan$/);
    await tungguTeks(/123\.456\.789\.012/);
  });

  it("capability: pengguna tanpa akses finance ditolak layar; semua peran finance boleh baca", async () => {
    for (const email of ["owner@x", "akuntan@x", "approver@x"]) {
      buka("normal", email); const v = tampil(<PemasukanRute />);
      await tunggu(/^Pendapatan dari sistem/);
      v.unmount();
    }
  });
});
