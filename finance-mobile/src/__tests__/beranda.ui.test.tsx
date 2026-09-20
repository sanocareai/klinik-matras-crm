import React from "react";
import { ScrollView } from "react-native";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as NetInfo from "@react-native-community/netinfo";
import { ThemeProvider } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useDashboard } from "@/hooks/data";
import { dashboardContoh } from "@/mocks/data";
import { setSkenario, type Skenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import { usePeriode } from "@/features/beranda/periodeStore";
import { PeriodeBar } from "@/features/beranda/PeriodeBar";
import { periodePreset } from "@/lib/periode";
import { BagianBelumTersedia, KartuLabaRugi, KesehatanPembukuan, PekerjaanTertunda, daftarTindakan } from "@/features/beranda/Bagian";
import Beranda from "../../app/(tabs)/index";

const router = jest.requireMock("expo-router") as { __push: jest.Mock };
const netinfo = NetInfo as unknown as { useNetInfo: jest.Mock };

function klien() {
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
}
function Bungkus({ children, client }: { children: React.ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
function tampil(ui: React.ReactElement, client = klien()) {
  return render(ui, { wrapper: ({ children }) => <Bungkus client={client}>{children}</Bungkus> });
}
function masuk(email: string) {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
}
const PERIODE = { from: "2026-09-01", to: "2026-09-30" };

beforeEach(() => {
  setSkenario("normal");
  usePeriode.setState({ id: "bulan-ini" });
  usePrefs.setState({ sembunyikanAngka: false });
  router.__push.mockClear();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
  masuk("finance@x");
});

describe("useDashboard: periode, refresh, galat", () => {
  const dipakai = (client: QueryClient) => ({
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });

  it("memuat data untuk periode, lalu refetch mengambil ulang dari server", async () => {
    const c = klien();
    const { result } = renderHook(() => useDashboard(PERIODE), dipakai(c));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.totalKas).toBe(dashboardContoh.totalKas);
    const query = c.getQueryCache().findAll({ queryKey: ["dashboard"] })[0];
    expect(query?.state.dataUpdateCount).toBe(1);
    await act(async () => { await result.current.refetch(); });
    expect(query?.state.dataUpdateCount).toBe(2); // benar-benar diambil ulang, bukan cache
  });

  it("ganti periode → kunci query berbeda; data lama tetap tampil (placeholder) selama memuat", async () => {
    const c = klien();
    const { result, rerender } = renderHook(({ p }: { p: { from: string; to: string } }) => useDashboard(p), { ...dipakai(c), initialProps: { p: PERIODE } });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ p: { from: "2026-08-01", to: "2026-08-31" } });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toBeDefined();
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(c.getQueryCache().findAll({ queryKey: ["dashboard"] }).map((q) => q.queryKey[1])).toEqual(expect.arrayContaining(["2026-09-01", "2026-08-01"]));
  });

  it("server error 5xx → isError setelah 1 kali ulang", async () => {
    setSkenario("galat");
    const { result } = renderHook(() => useDashboard(PERIODE), dipakai(klien()));
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.data).toBeUndefined();
  });

  it("sesi habis (401) tidak diulang otomatis", async () => {
    setSkenario("sesi");
    const { result } = renderHook(() => useDashboard(PERIODE), dipakai(klien()));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.failureCount).toBe(1);
  });
});

describe("komponen bagian Beranda", () => {
  it("laba rugi negatif: judul Rugi bersih, label bacaan memuat rupiah penuh", () => {
    const negatif = { ...(dashboardContoh.labaRugi as NonNullable<typeof dashboardContoh.labaRugi>), labaKotor: "-104893765.00", labaBersih: "-199887351.00", marginBersih: -6662.91 } as never;
    tampil(<KartuLabaRugi data={negatif} />);
    expect(screen.getByText("Rugi bersih")).toBeTruthy();
    expect(screen.getByLabelText("Laba kotor: -Rp 104.893.765")).toBeTruthy();
    expect(screen.getByText("Margin bersih -6.662,9%")).toBeTruthy();
    expect(screen.getByText("-Rp 199.887.351")).toBeTruthy();
  });

  it("nominal disembunyikan: tidak ada angka di layar", () => {
    usePrefs.setState({ sembunyikanAngka: true });
    tampil(<KartuLabaRugi data={dashboardContoh.labaRugi as never} />);
    expect(screen.queryByText(/41\.750\.000/)).toBeNull();
    expect(screen.getAllByLabelText("Nominal disembunyikan").length).toBeGreaterThan(0);
  });

  it("pekerjaan tertunda: tekan membuka tujuan; kosong menampilkan pesan positif", () => {
    const onBuka = jest.fn();
    const d = daftarTindakan(dashboardContoh.antrean, 2, useSession.getState().capabilities);
    const { unmount } = tampil(<PekerjaanTertunda daftar={d} onBuka={onBuka} />);
    fireEvent.press(screen.getByLabelText(/^Menunggu persetujuan: 29/));
    expect(onBuka).toHaveBeenCalledWith("/persetujuan");
    unmount();
    tampil(<PekerjaanTertunda daftar={[]} onBuka={onBuka} />);
    expect(screen.getByText("Tidak ada pekerjaan tertunda")).toBeTruthy();
  });

  it("kesehatan pembukuan: baik vs perlu perhatian, dengan label bacaan", () => {
    const { unmount } = tampil(<KesehatanPembukuan catatan={{ gapTerbuka: 0, saldoAwalTerisi: true, mulaiPembukuan: "2026-08-01", periodeTerbuka: 1, pesan: [] }} gate={{ aktif: true, sejak: null }} />);
    expect(screen.getByLabelText("Kesehatan pembukuan: baik")).toBeTruthy();
    expect(screen.getByLabelText("Verifikasi pembayaran: Wajib sebelum berstatus lunas")).toBeTruthy();
    unmount();
    tampil(<KesehatanPembukuan catatan={{ gapTerbuka: 3, saldoAwalTerisi: false, mulaiPembukuan: null, periodeTerbuka: null, pesan: ["Saldo awal belum pernah diinput"] }} gate={null} />);
    expect(screen.getByLabelText("Kesehatan pembukuan: perlu perhatian")).toBeTruthy();
    expect(screen.getByLabelText("Data belum lengkap: 3 transaksi")).toBeTruthy();
  });

  it("bagian belum tersedia menawarkan coba lagi", () => {
    const onCoba = jest.fn();
    tampil(<BagianBelumTersedia bagian="piutang" onCoba={onCoba} />);
    expect(screen.getByText("Data piutang belum tersedia")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Muat ulang piutang"));
    expect(onCoba).toHaveBeenCalled();
  });
});

describe("pilihan periode", () => {
  it("chip berlabel bacaan; sheet menampilkan pilihan; memilih memanggil onPilih", () => {
    const onPilih = jest.fn();
    const periode = periodePreset()[0] as ReturnType<typeof periodePreset>[number];
    tampil(<PeriodeBar periode={periode} onPilih={onPilih} memuat={false} diperbaruiMs={Date.now() - 120_000} />);
    const chip = screen.getByLabelText(`Periode laporan: ${periode.label}. Ketuk untuk mengganti`);
    expect(screen.getByText(/Diperbarui \d\d\.\d\d WIB · 2 menit lalu/)).toBeTruthy();
    fireEvent.press(chip);
    expect(screen.getByText("Pilih periode")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Tahun " + new Date().getFullYear()));
    expect(onPilih).toHaveBeenCalledWith("tahun-ini");
  });

  it("saat memuat menampilkan Memuat…", () => {
    tampil(<PeriodeBar periode={periodePreset()[0] as never} onPilih={jest.fn()} memuat diperbaruiMs={null} />);
    expect(screen.getByText("Memuat…")).toBeTruthy();
  });
});

describe("layar Beranda: state & role", () => {
  function bukaBeranda(skenario: Skenario = "normal", email = "finance@x") {
    setSkenario(skenario);
    masuk(email);
    return tampil(<Beranda />);
  }

  it("loading menampilkan skeleton berlabel; lalu data muncul", async () => {
    bukaBeranda();
    expect(screen.getByLabelText("Memuat Beranda")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Total kas & bank")).toBeTruthy());
    expect(screen.getByText("Saldo per rekening")).toBeTruthy();
    expect(screen.getByLabelText("Total kas dan bank: Rp 272.950.725,50")).toBeTruthy();
  });

  it("FINANCE melihat aksi cepat; APPROVER tidak; ACCOUNTANT tanpa Verifikasi pembayaran", async () => {
    const a = bukaBeranda("normal", "finance@x");
    await waitFor(() => expect(screen.getByLabelText("Verifikasi pembayaran")).toBeTruthy());
    a.unmount();
    const b = bukaBeranda("normal", "approver@x");
    await waitFor(() => expect(screen.getByText("Total kas & bank")).toBeTruthy());
    expect(screen.queryByText("Aksi cepat")).toBeNull();
    b.unmount();
    bukaBeranda("normal", "akuntan@x");
    await waitFor(() => expect(screen.getByLabelText("Foto nota")).toBeTruthy());
    expect(screen.queryByLabelText("Verifikasi pembayaran")).toBeNull();
    expect(screen.queryByLabelText(/^Menunggu persetujuan/)).toBeNull();
  });

  it("server error → panel galat berbahasa Indonesia + Coba lagi, tanpa pesan teknis", async () => {
    bukaBeranda("galat");
    await waitFor(() => expect(screen.getByText("Server sedang bermasalah")).toBeTruthy(), { timeout: 4000 });
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.getByLabelText("Coba lagi")).toBeTruthy();
  });

  it("offline tanpa data → Tidak ada koneksi + banner offline", async () => {
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    bukaBeranda("offline");
    await waitFor(() => expect(screen.getAllByText("Tidak ada koneksi").length).toBeGreaterThan(0), { timeout: 4000 });
    expect(screen.getByText("Tidak ada koneksi internet")).toBeTruthy();
  });

  it("sesi habis → panel Sesi Anda berakhir tanpa tombol coba lagi", async () => {
    bukaBeranda("sesi");
    await waitFor(() => expect(screen.getByText("Sesi Anda berakhir")).toBeTruthy());
    expect(screen.queryByLabelText("Coba lagi")).toBeNull();
  });

  it("data kosong → state kosong ramah, kesehatan pembukuan tetap tampil", async () => {
    bukaBeranda("kosong");
    await waitFor(() => expect(screen.getByText("Belum ada data keuangan")).toBeTruthy());
    expect(screen.getByText("Kesehatan pembukuan")).toBeTruthy();
  });

  it("data parsial → bagian yang hilang dijelaskan, sisanya tetap tampil", async () => {
    bukaBeranda("parsial");
    await waitFor(() => expect(screen.getByText("Data laba rugi belum tersedia")).toBeTruthy());
    expect(screen.getByText("Data piutang belum tersedia")).toBeTruthy();
    expect(screen.getByLabelText("Total kas dan bank: Rp 272.950.725,50")).toBeTruthy();
    expect(screen.getByText("Total utang usaha")).toBeTruthy();
  });

  it("angka sangat panjang & negatif: nominal satu baris (adjustsFontSizeToFit) dan label bacaan penuh", async () => {
    bukaBeranda("panjang");
    await waitFor(() => expect(screen.getByText("Total kas & bank")).toBeTruthy());
    expect(screen.getByLabelText("Total kas dan bank: Rp 97.530.864.219.753,09")).toBeTruthy();
    const nominal = screen.getAllByText(/Rp 98\.765\.432\.109\.876/)[0];
    expect(nominal?.props.numberOfLines).toBe(1);
    expect(nominal?.props.adjustsFontSizeToFit).toBe(true);
    expect(screen.getByLabelText(/Kas Besar: -Rp 1\.234\.567\.890\.123,45/)).toBeTruthy();
  });

  it("tarik-untuk-muat gagal → data lama tetap tampil + banner Gagal memperbarui", async () => {
    bukaBeranda("basi");
    await waitFor(() => expect(screen.getByText("Total kas & bank")).toBeTruthy());
    const sv = screen.UNSAFE_getByType(ScrollView);
    await act(async () => { (sv.props.refreshControl as React.ReactElement<{ onRefresh: () => void }>).props.onRefresh(); });
    await waitFor(() => expect(screen.getByText("Gagal memperbarui")).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText("Total kas & bank")).toBeTruthy();
    expect(screen.getByLabelText("Coba muat ulang")).toBeTruthy();
  });

  it("tap pekerjaan tertunda mengarahkan ke layar terkait", async () => {
    bukaBeranda();
    await waitFor(() => expect(screen.getByLabelText(/^Menunggu persetujuan: 29/)).toBeTruthy());
    fireEvent.press(screen.getByLabelText(/^Menunggu persetujuan: 29/));
    expect(router.__push).toHaveBeenCalledWith("/persetujuan");
  });
});
