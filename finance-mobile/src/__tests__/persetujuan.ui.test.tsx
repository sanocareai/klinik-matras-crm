import React from "react";
import { FlatList } from "react-native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as NetInfo from "@react-native-community/netinfo";
import { ThemeProvider } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { setSkenario, type Skenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import Persetujuan from "../../app/(tabs)/persetujuan";
import Detail from "../../app/persetujuan/[jenis]/[id]";

const router = jest.requireMock("expo-router") as { __push: jest.Mock; __setParams: (p: object) => void };
const netinfo = NetInfo as unknown as { useNetInfo: jest.Mock };
const T = { timeout: 5000 };

function tampil(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}><ThemeProvider>{children}</ThemeProvider></QueryClientProvider> });
}
function masuk(email: string) {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
}
function buka(skenario: Skenario = "normal", email = "approver@x") {
  setSkenario(skenario);
  masuk(email);
}
function bukaDetail(jenis: string, id: string, skenario: Skenario = "normal", email = "approver@x") {
  buka(skenario, email);
  router.__setParams({ jenis, id });
  return tampil(<Detail />);
}
const tekan = (label: string | RegExp) => fireEvent.press(screen.getByLabelText(label));
const semuaLabel = (label: string) => screen.getAllByLabelText(label);

beforeEach(() => {
  usePrefs.setState({ sembunyikanAngka: false });
  router.__push.mockClear();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() }); // step-up lolos: baru saja membuka kunci
});

describe("Inbox Persetujuan: daftar", () => {
  it("empat tab dengan jumlah dari server; yang menunggu urut paling lama dulu; kartu berlabel bacaan lengkap", async () => {
    buka();
    tampil(<Persetujuan />);
    expect(screen.getByLabelText("Memuat daftar persetujuan")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu")).getByText("29")).toBeTruthy(), T);
    expect(within(screen.getByLabelText("Diproses")).getByText("2")).toBeTruthy();
    expect(within(screen.getByLabelText("Disetujui")).getByText("2")).toBeTruthy();
    expect(within(screen.getByLabelText("Ditolak")).getByText("1")).toBeTruthy();
    const kartu = screen.getAllByLabelText(/, diajukan .*, 9 hari, Menunggu persetujuan/);
    expect(kartu.length).toBeGreaterThan(0); // terlama (9 hari) di paling atas
    expect(screen.getAllByLabelText(/^(Pengeluaran|Pembelian|Tagihan supplier|Refund) [A-Z]+-\d+/)[0]?.props.accessibilityLabel).toMatch(/9 hari/);
  });

  it("paginasi: halaman pertama 20, 'Muat lebih banyak' menambah sisanya, lalu penutup 'sudah semua'", async () => {
    buka();
    tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getByLabelText("Muat lebih banyak")).toBeTruthy(), T);
    tekan("Muat lebih banyak");
    await waitFor(() => expect(screen.getByText("29 pengajuan · sudah semua")).toBeTruthy(), T);
    expect(screen.queryByLabelText("Muat lebih banyak")).toBeNull();
  });

  it("pencarian (debounce) menyaring dari server; tombol hapus mengembalikan daftar; tidak cocok → state kosong dengan atur ulang", async () => {
    buka("normal", "finance@x");
    tampil(<Persetujuan />);
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu")).getByText("29")).toBeTruthy(), T);
    fireEvent.changeText(screen.getByLabelText("Cari pengajuan"), "forklift");
    await waitFor(() => expect(screen.getByText("1 pengajuan · sudah semua")).toBeTruthy(), T);
    expect(screen.getByText("Sewa forklift bongkar kain (2 hari)")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Cari pengajuan"), "zzzz-tidak-ada");
    await waitFor(() => expect(screen.getByText("Tidak ada yang cocok")).toBeTruthy(), T);
    tekan("Atur ulang");
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu")).getByText("29")).toBeTruthy(), T);
    expect((screen.getByLabelText("Cari pengajuan") as { props: { value: string } }).props.value).toBe("");
  });

  it("filter jenis: sheet → pilih Refund → terapkan → hanya refund; tombol filter memberi tahu jumlah aktif", async () => {
    buka();
    tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getByLabelText("Filter")).toBeTruthy(), T);
    tekan("Filter");
    expect(screen.getByText("Filter pengajuan")).toBeTruthy();
    tekan("Refund");
    tekan("Terapkan");
    await waitFor(() => expect(screen.getByText("7 pengajuan · sudah semua")).toBeTruthy(), T);
    expect(screen.getByLabelText("Filter, 1 aktif")).toBeTruthy();
  });

  it("tab Ditolak menampilkan status & tautan ke detail berjenis + id dari server", async () => {
    buka();
    tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getByLabelText("Ditolak")).toBeTruthy(), T);
    tekan("Ditolak");
    await waitFor(() => expect(screen.getByText("Kain sample warna")).toBeTruthy(), T);
    fireEvent.press(screen.getByLabelText(/^Pembelian PUR-.*Ditolak/));
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/persetujuan/[jenis]/[id]", params: { jenis: "purchase", id: expect.stringMatching(/^mock-/) } });
  });

  it("state: kosong (ramah), server error, sesi habis, offline, data lama + banner saat penyegaran gagal", async () => {
    buka("kosong");
    const a = tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getByText("Tidak ada yang menunggu")).toBeTruthy(), T);
    a.unmount();

    buka("galat");
    const b = tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getByText("Server sedang bermasalah")).toBeTruthy(), T);
    expect(screen.getByLabelText("Coba lagi")).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
    b.unmount();

    buka("sesi");
    const c = tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getByText("Sesi Anda berakhir")).toBeTruthy(), T);
    c.unmount();

    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    buka("offline");
    tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getAllByText("Tidak ada koneksi").length).toBeGreaterThan(0), T);
    expect(screen.getByText("Tidak ada koneksi internet")).toBeTruthy();
  });

  it("penyegaran (tarik ke bawah) gagal setelah data ada → daftar lama tetap, banner 'Gagal memperbarui' + coba lagi", async () => {
    buka("basi");
    tampil(<Persetujuan />);
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu")).getByText("29")).toBeTruthy(), T);
    const segarkan = async () => {
      const daftar = screen.UNSAFE_getByType(FlatList);
      await act(async () => { (daftar.props.refreshControl as React.ReactElement<{ onRefresh: () => void }>).props.onRefresh(); });
    };
    await segarkan(); // panggilan ke-2 masih berhasil
    await segarkan(); // panggilan ke-3: koneksi hilang
    await waitFor(() => expect(screen.getByText("Gagal memperbarui")).toBeTruthy(), T);
    expect(within(screen.getByLabelText("Menunggu")).getByText("29")).toBeTruthy(); // data lama tidak hilang
    expect(screen.getByLabelText("Coba muat ulang")).toBeTruthy();
  });

  it("peran tanpa izin approve (akuntan): layar ditolak dengan penjelasan, tidak ada daftar", () => {
    buka("normal", "akuntan@x");
    tampil(<Persetujuan />);
    expect(screen.getByText("Anda tidak punya akses")).toBeTruthy();
    expect(screen.queryByLabelText("Cari pengajuan")).toBeNull();
  });

  it("'Sembunyikan nominal' menyamarkan keterangan, vendor/pelanggan, dan label bacaan (tanpa rupiah)", async () => {
    buka("normal", "finance@x");
    usePrefs.setState({ sembunyikanAngka: true });
    tampil(<Persetujuan />);
    await waitFor(() => expect(screen.getAllByLabelText("Disamarkan").length).toBeGreaterThan(0), T);
    expect(screen.queryByText("Sewa forklift bongkar kain (2 hari)")).toBeNull();
    expect(screen.queryByText("Toko Contoh")).toBeNull();
    for (const k of screen.getAllByLabelText(/^(Pengeluaran|Pembelian|Tagihan supplier|Refund) [A-Z]+-\d+/)) {
      expect(k.props.accessibilityLabel).not.toMatch(/Rp/);
      expect(k.props.accessibilityLabel).toMatch(/nominal disembunyikan/);
    }
  });
});

describe("Inbox Persetujuan: detail & keputusan", () => {
  it("detail memuat jenis/nomor, rincian, lampiran, riwayat; tombol dari `aksi` server", async () => {
    bukaDetail("purchase", "mock-2");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    expect(screen.getByText("Busa HD density 26 — 40 lembar")).toBeTruthy();
    expect(screen.getByText("CV Foam Nusantara")).toBeTruthy();
    expect(screen.getByLabelText("Buka foto lampiran 1")).toBeTruthy();
    expect(screen.getByText(/^Diajukan · /)).toBeTruthy();
    expect(screen.getAllByLabelText("Setujui")[0]?.props.accessibilityState.disabled).toBe(false);
    expect(screen.getByLabelText("Tolak").props.accessibilityState.disabled).toBe(false);
  });

  it("setujui: konfirmasi → step-up lolos → status resmi diambil ulang dan ditampilkan (sudah diputuskan)", async () => {
    bukaDetail("purchase", "mock-2");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    tekan("Setujui");
    expect(screen.getByText("Setujui pengajuan?")).toBeTruthy();
    fireEvent.press(semuaLabel("Setujui").at(-1) as never);
    await waitFor(() => expect(screen.getByText(/disetujui\. Status resmi dimuat dari server/)).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByText(/Sudah diputuskan oleh/)).toBeTruthy(), T);
    expect(screen.queryAllByLabelText("Setujui")).toHaveLength(0); // tombol hilang: bukan lagi MENUNGGU
  });

  it("tolak: alasan kosong / terlalu pendek menonaktifkan tombol; alasan sah → ditolak & alasan tampil di riwayat", async () => {
    bukaDetail("expense", "mock-1");
    await waitFor(() => expect(screen.getByText(/^Pengeluaran · EXP-/)).toBeTruthy(), T);
    tekan("Tolak");
    expect(screen.getByLabelText("Tolak pengajuan").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/Alasan wajib diisi/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Alasan penolakan"), "  ab ");
    expect(screen.getByLabelText("Tolak pengajuan").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Alasan penolakan"), "Nota buram, mohon unggah ulang");
    expect(screen.getByLabelText("Tolak pengajuan").props.accessibilityState.disabled).toBe(false);
    tekan("Tolak pengajuan");
    await waitFor(() => expect(screen.getByText(/ditolak\. Alasan tercatat/)).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByText(/Sudah ditolak oleh/)).toBeTruthy(), T);
    expect(screen.getAllByText(/Nota buram, mohon unggah ulang/).length).toBeGreaterThan(0);
  });

  it("pemisahan tugas: pengajuan sendiri → Setujui nonaktif dengan alasan server; Tolak tetap tersedia", async () => {
    bukaDetail("expense", "mock-5", "normal", "finance@x");
    await waitFor(() => expect(screen.getByText(/^Pengeluaran · EXP-/)).toBeTruthy(), T);
    expect(screen.getAllByLabelText("Setujui")[0]?.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("Pengajuan Anda sendiri harus disetujui orang lain.")).toBeTruthy();
    expect(screen.getByLabelText("Tolak").props.accessibilityState.disabled).toBe(false);
  });

  it("syarat nota dari server: tombol nonaktif tetapi TIDAK disembunyikan, pesan server terlihat", async () => {
    bukaDetail("expense", "mock-1");
    await waitFor(() => expect(screen.getByText(/^Pengeluaran · EXP-/)).toBeTruthy(), T);
    expect(screen.getAllByLabelText("Setujui")[0]?.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("Pengeluaran ini wajib punya foto nota sebelum disetujui.")).toBeTruthy();
  });

  it("konflik (409): sudah diproses pengguna lain → pesan Indonesia + status terbaru dimuat ulang tanpa retry otomatis", async () => {
    bukaDetail("purchase", "mock-2", "konflik");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    tekan("Setujui");
    fireEvent.press(semuaLabel("Setujui").at(-1) as never);
    await waitFor(() => expect(screen.getByText(/sudah diproses pengguna lain/)).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByText(/Sudah diputuskan oleh Penyetuju Lain/)).toBeTruthy(), T);
  });

  it("izin dicabut (403): pesan 'Izin Anda berubah'", async () => {
    bukaDetail("purchase", "mock-2", "izin");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    tekan("Setujui");
    fireEvent.press(semuaLabel("Setujui").at(-1) as never);
    await waitFor(() => expect(screen.getByText(/Izin Anda berubah/)).toBeTruthy(), T);
  });

  it("hasil tidak pasti (putus setelah kirim): pesan 'belum pasti', bukan sukses palsu; tombol tetap bisa dicoba lagi", async () => {
    bukaDetail("purchase", "mock-2", "putus");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    tekan("Setujui");
    fireEvent.press(semuaLabel("Setujui").at(-1) as never);
    await waitFor(() => expect(screen.getByText(/hasilnya belum pasti/)).toBeTruthy(), T);
    expect(screen.queryByText(/disetujui. Status resmi/)).toBeNull();
    expect(screen.getAllByLabelText("Setujui")[0]?.props.accessibilityState.disabled).toBe(false);
  });

  it("offline: tombol keputusan nonaktif dengan penjelasan", async () => {
    bukaDetail("purchase", "mock-2");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    await act(async () => { screen.rerender(<Detail />); });
    expect(screen.getByText("Butuh koneksi internet")).toBeTruthy();
    expect(screen.getAllByLabelText("Setujui")[0]?.props.accessibilityState.disabled).toBe(true);
  });

  it("'Sembunyikan nominal': lampiran, vendor, keterangan, dan nominal di konfirmasi disamarkan", async () => {
    usePrefs.setState({ sembunyikanAngka: true });
    bukaDetail("purchase", "mock-2");
    await waitFor(() => expect(screen.getByText(/^Pembelian · PUR-/)).toBeTruthy(), T);
    expect(screen.getByLabelText("Lampiran disembunyikan")).toBeTruthy();
    expect(screen.queryByLabelText("Buka foto lampiran 1")).toBeNull();
    expect(screen.queryByText("CV Foam Nusantara")).toBeNull();
    expect(screen.queryByText("Busa HD density 26 — 40 lembar")).toBeNull();
    tekan("Setujui");
    expect(screen.getAllByLabelText("Nominal disembunyikan").length).toBeGreaterThan(0);
  });

  it("dokumen tidak ada → state kosong dengan tombol kembali", async () => {
    bukaDetail("purchase", "tidak-ada");
    await waitFor(() => expect(screen.getByText("Dokumen tidak ditemukan")).toBeTruthy(), T);
  });
});
