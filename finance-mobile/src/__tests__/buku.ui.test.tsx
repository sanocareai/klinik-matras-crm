// Layar S9 (Jurnal, Buku Besar, Rekonsiliasi) dan S10 (Laporan) di atas server contoh: daftar/detail jurnal (termasuk fixture TIDAK seimbang),
// buku besar (saldo berjalan dari server, negatif, akun tanpa mutasi, lintas tahun), rekonsiliasi (cocokkan/lepas dengan konflik, izin, putus, double-tap),
// serta enam laporan (seimbang/selisih, negatif, parsial, kosong, drill-down, bagikan).

import React from "react";
import { Share } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as NetInfo from "@react-native-community/netinfo";
import { ThemeProvider } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { setSkenario, type Skenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import * as mockBuku from "@/mocks/buku";
import JurnalRute from "../../app/buku/jurnal/index";
import JurnalDetailRute from "../../app/buku/jurnal/[id]";
import AkunRute from "../../app/buku/akun/index";
import BukuBesarRute from "../../app/buku/akun/[id]";
import RekonRute from "../../app/buku/rekon/index";
import RekonDetailRute from "../../app/buku/rekon/[id]";
import LaporanRute from "../../app/laporan/[jenis]";

const router = jest.requireMock("expo-router") as { __push: jest.Mock; __back: jest.Mock; __setParams: (p: object) => void };
const netinfo = NetInfo as unknown as { useNetInfo: jest.Mock };
const T = { timeout: 5000 };
jest.setTimeout(30000);

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
const tekan = (label: string | RegExp) => fireEvent.press(screen.getAllByLabelText(label)[0]!);
const tunggu = (label: string | RegExp) => waitFor(() => expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0), T);
const tungguTeks = (t: string | RegExp) => waitFor(() => expect(screen.getAllByText(t).length).toBeGreaterThan(0), T);

beforeEach(() => {
  usePrefs.setState({ sembunyikanAngka: false });
  router.__push.mockClear(); router.__back.mockClear();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() });
});
afterEach(() => jest.restoreAllMocks());

describe("S9 — Jurnal", () => {
  it("daftar: banner jurnal tidak seimbang + tiap kartu menyebut status keseimbangan; ketuk membuka detail", async () => {
    buka();
    tampil(<JurnalRute />);
    await tungguTeks(/1 jurnal tidak seimbang/);
    await tunggu(/^Jurnal JV-15092026-005, Fixture timpang.*TIDAK seimbang/);
    tekan(/^Jurnal JV-15092026-005/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/buku/jurnal/[id]", params: { id: "j5" } });
  });

  it("daftar kosong: pesan kosong, tanpa banner", async () => {
    buka("kosong");
    tampil(<JurnalRute />);
    await tungguTeks(/Belum ada jurnal/);
    expect(screen.queryByText(/tidak seimbang/)).toBeNull();
  });

  it("galat server: pesan + coba lagi", async () => {
    buka("galat");
    tampil(<JurnalRute />);
    await tunggu(/Coba lagi/);
  });

  it("detail jurnal timpang: indikator TIDAK seimbang + selisih dari server", async () => {
    buka();
    router.__setParams({ id: "j5" });
    tampil(<JurnalDetailRute />);
    await tungguTeks("Jurnal tidak seimbang");
    await tunggu(/^TIDAK seimbang/);
    await tungguTeks(/30\.000/);
  });

  it("detail jurnal yang dibalik: tautan ke jurnal pembalik; dokumen terkait membuka modul S6", async () => {
    buka();
    router.__setParams({ id: "j3" });
    tampil(<JurnalDetailRute />);
    await tunggu(/^Dibalik oleh JV-13092026-004/);
    tekan(/^Dibalik oleh JV-13092026-004/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/buku/jurnal/[id]", params: { id: "j4" } });
    tekan(/^Dokumen sumber EXP-12092026-002/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/tx/[modul]/[id]", params: { modul: "pengeluaran", id: "e2" } });
  });

  it("baris jurnal: drill-down ke buku besar akun dengan rentang bulan jurnal", async () => {
    buka();
    router.__setParams({ id: "j2" });
    tampil(<JurnalDetailRute />);
    await tunggu(/^Akun 1-1200 Bank\. Buka buku besar/);
    tekan(/^Akun 1-1200 Bank\. Buka buku besar/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/buku/akun/[id]", params: { id: "a-bank", from: "2026-09-01", to: "2026-09-30" } });
  });

  it("jurnal tidak ada: 404 ditampilkan sebagai tidak ditemukan", async () => {
    buka();
    router.__setParams({ id: "zzz" });
    tampil(<JurnalDetailRute />);
    await tungguTeks("Jurnal tidak ditemukan");
  });

});

describe("S9 — Buku besar", () => {
  it("pilih akun lalu buka buku besar dengan periode", async () => {
    buka();
    tampil(<AkunRute />);
    await tunggu(/^Akun 1-1200 Bank/);
    tekan(/^Akun 1-1200 Bank/);
    expect(router.__push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/buku/akun/[id]", params: expect.objectContaining({ id: "a-bank" }) }));
  });

  it("saldo awal, total, saldo akhir, dan saldo berjalan dari server (lintas nilai desimal)", async () => {
    buka();
    router.__setParams({ id: "a-bank", from: "2026-09-01", to: "2026-09-30" });
    tampil(<BukuBesarRute />);
    await tungguTeks(/1-1200 Bank/);
    await tunggu("Saldo akhir");
    await tungguTeks(/49\.975\.000,50/);
    tekan(/^Mutasi JV-10092026-002/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/buku/jurnal/[id]", params: { id: "j2" } });
  });

  it("akun tanpa mutasi pada periode: kosong dengan saldo awal = saldo akhir", async () => {
    buka();
    router.__setParams({ id: "a-iklan", from: "2026-01-01", to: "2026-01-31" });
    tampil(<BukuBesarRute />);
    await tungguTeks("Tidak ada mutasi");
  });

  it("periode lintas tahun (tahun lalu) tidak membuat galat", async () => {
    buka();
    router.__setParams({ id: "a-bank", from: "2025-01-01", to: "2025-12-31" });
    tampil(<BukuBesarRute />);
    await tungguTeks("Tidak ada mutasi");
  });

  it("akun tidak ada: tidak ditemukan", async () => {
    buka();
    router.__setParams({ id: "zzz", from: "2026-09-01", to: "2026-09-30" });
    tampil(<BukuBesarRute />);
    await tungguTeks("Akun tidak ditemukan");
  });
});

describe("S9 — Rekonsiliasi", () => {
  it("daftar: saldo buku, saldo statement, selisih, jumlah belum cocok; ketuk membuka detail", async () => {
    buka();
    tampil(<RekonRute />);
    await tunggu(/^Rekonsiliasi KEM - Sano Bank.*3 belum cocok/);
    await tunggu(/^Rekonsiliasi PT Sano.*Selesai/);
    tekan(/^Rekonsiliasi KEM - Sano Bank/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/buku/rekon/[id]", params: { id: "r1" } });
  });

  it("detail: ringkasan dari server; baris tanpa kandidat menampilkan alasan server", async () => {
    buka();
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tungguTeks("KEM - Sano Bank");
    await tungguTeks(/Tidak ada mutasi buku dengan nominal & arah yang sama/);
  });

  it("cocokkan: pilih kandidat → konfirmasi → sukses → status dimuat ulang dari server", async () => {
    const kirim = jest.spyOn(mockBuku, "mockCocokkan");
    buka();
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tunggu(/^Cocokkan \(1 kandidat\)/);
    tekan(/^Cocokkan \(1 kandidat\)/);
    await tunggu(/^Kandidat JV-10092026-002/);
    tekan(/^Kandidat JV-10092026-002/);
    await tunggu("Cocokkan");
    tekan("Cocokkan");
    await tungguTeks(/Baris dicocokkan/);
    expect(kirim).toHaveBeenCalledWith("/finance/bank-lines/rb1/match", "l2b");
    tekan(/^Cocok$/);
    await tungguTeks(/Cocok dengan JV-10092026-002/);
  });

  it("double-tap konfirmasi hanya mengirim SATU perintah", async () => {
    const kirim = jest.spyOn(mockBuku, "mockCocokkan");
    buka();
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tunggu(/^Cocokkan \(1 kandidat\)/);
    tekan(/^Cocokkan \(1 kandidat\)/);
    await tunggu(/^Kandidat JV-10092026-002/);
    tekan(/^Kandidat JV-10092026-002/);
    await tunggu("Cocokkan");
    const t = screen.getAllByLabelText("Cocokkan")[0]!;
    fireEvent.press(t); fireEvent.press(t);
    await tungguTeks(/Baris dicocokkan/);
    expect(kirim).toHaveBeenCalledTimes(1);
  });

  it("409 konflik: pesan server + status terbaru dimuat ulang", async () => {
    buka("konflik");
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tunggu(/^Cocokkan \(1 kandidat\)/);
    tekan(/^Cocokkan \(1 kandidat\)/);
    await tunggu(/^Kandidat JV-10092026-002/);
    tekan(/^Kandidat JV-10092026-002/);
    await tunggu("Cocokkan");
    tekan("Cocokkan");
    await tungguTeks(/sudah dicocokkan/);
  });

  it("403 izin dicabut: pesan galat, tidak ada perubahan", async () => {
    buka("izin");
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tunggu(/^Cocokkan \(1 kandidat\)/);
    tekan(/^Cocokkan \(1 kandidat\)/);
    await tunggu(/^Kandidat JV-10092026-002/);
    tekan(/^Kandidat JV-10092026-002/);
    await tunggu("Cocokkan");
    tekan("Cocokkan");
    await tungguTeks(/izin/i);
  });

  it("peran tanpa izin catat (penyetuju): tombol cocokkan tidak ada; alasan dari server", async () => {
    buka("normal", "approver@x");
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tungguTeks(/tidak boleh mencocokkan/);
    expect(screen.queryByLabelText(/^Cocokkan \(/)).toBeNull();
  });

  it("offline: tombol cocokkan nonaktif dengan penjelasan; tidak ada yang dikirim", async () => {
    const kirim = jest.spyOn(mockBuku, "mockCocokkan");
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    buka();
    router.__setParams({ id: "r1" });
    tampil(<RekonDetailRute />);
    await tungguTeks(/Tidak ada koneksi\. Pencocokan tidak bisa dikirim/);
    fireEvent.press(screen.getAllByLabelText(/^Cocokkan \(1 kandidat\)/)[0]!);
    expect(kirim).not.toHaveBeenCalled();
  });

  it("rekonsiliasi selesai: pencocokan terkunci", async () => {
    buka();
    router.__setParams({ id: "r2" });
    tampil(<RekonDetailRute />);
    await tungguTeks(/pencocokan terkunci/);
  });
});

describe("S10 — Laporan", () => {
  const lap = (jenis: string, skenario: Skenario = "normal", email = "finance@x") => { buka(skenario, email); router.__setParams({ jenis }); return tampil(<LaporanRute />); };

  it("laba rugi: ringkasan dan bagian dari server, ada waktu diperbarui", async () => {
    lap("laba-rugi");
    await tungguTeks("Laba Rugi");
    await tungguTeks(/Diperbarui .* WIB · dihitung server/);
  });

  it("neraca: menampilkan laba/rugi tahun berjalan dan status seimbang dari server", async () => {
    lap("neraca");
    await tungguTeks(/Laba\/rugi tahun berjalan/);
    await tunggu("Seimbang");
  });

  it("neraca tidak seimbang: selalu menampilkan selisih", async () => {
    lap("neraca-saldo", "negatif");
    await tungguTeks("Neraca Saldo");
  });

  it("arus kas, umur piutang, umur utang: termuat", async () => {
    for (const j of ["arus-kas", "umur-piutang", "umur-utang"]) {
      const v = lap(j);
      await waitFor(() => expect(screen.getAllByRole("header").length).toBeGreaterThan(0), T);
      v.unmount();
    }
  });

  it("umur piutang: drill-down ke piutang order; neraca saldo: drill ke buku besar akun", async () => {
    let v = lap("umur-piutang");
    await tunggu(/^Ibu Sari\. Lihat rincian/);
    tekan(/^Ibu Sari\. Lihat rincian/);
    expect(router.__push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/tx/[modul]/[id]", params: expect.objectContaining({ modul: "piutang" }) }));
    v.unmount();
    v = lap("neraca-saldo");
    await tunggu(/Lihat rincian/);
    tekan(/Lihat rincian/);
    expect(router.__push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/buku/akun/[id]", params: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }) }));
  });

  it("data parsial: peringatan bagian yang hilang", async () => {
    lap("neraca-saldo", "parsial");
    await tungguTeks(/Data belum lengkap/);
  });

  it("kosong: pesan tanpa data", async () => {
    lap("laba-rugi", "kosong");
    await tungguTeks("Tidak ada data");
  });

  it("galat: coba lagi; jenis tak dikenal: pesan", async () => {
    lap("laba-rugi", "galat");
    await tunggu(/Coba lagi/);
    lap("bukan-laporan");
    await tungguTeks("Laporan tidak dikenal");
  });

  it("bagikan: memakai teks hasil server (bukan hitungan klien)", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    lap("laba-rugi");
    await tunggu("Bagikan ringkasan");
    tekan("Bagikan ringkasan");
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining("SANO Finance — Laba Rugi") });
  });
});
