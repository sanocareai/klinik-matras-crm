import React from "react";
import { FlatList, Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as NetInfo from "@react-native-community/netinfo";
import { ThemeProvider } from "@/design/theme";
import { ApiError } from "@/api/errors";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { setSkenario, type Skenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import * as mockBayar from "@/mocks/pembayaran";
import { BuktiPembayaran } from "@/features/pembayaran/BuktiPembayaran";
import Daftar from "../../app/pembayaran/index";
import Detail from "../../app/pembayaran/[id]";
import Transaksi from "../../app/(tabs)/transaksi";

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
function buka(skenario: Skenario = "normal", email = "finance@x") {
  setSkenario(skenario);
  masuk(email);
}
function bukaDetail(id: string, skenario: Skenario = "normal", email = "finance@x") {
  buka(skenario, email);
  router.__setParams({ id });
  return tampil(<Detail />);
}
const tekan = (label: string | RegExp) => fireEvent.press(screen.getByLabelText(label));
const semuaLabel = (label: string) => screen.getAllByLabelText(label);
/** Tombol "Verifikasi" di lembar konfirmasi = yang terakhir di pohon (tombol halaman lebih dulu). */
const konfirmasiVerifikasi = () => fireEvent.press(semuaLabel("Verifikasi").at(-1) as never);

beforeEach(() => {
  usePrefs.setState({ sembunyikanAngka: false });
  router.__push.mockClear();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() }); // step-up lolos: baru saja membuka kunci
});
afterEach(() => jest.restoreAllMocks());
// Linking.openURL sudah berupa jest.fn di jest-expo: panggilan dari tes lain menumpuk kecuali dibersihkan.
beforeEach(() => { (Linking.openURL as unknown as jest.Mock).mockClear?.(); });

describe("Pembayaran: daftar", () => {
  it("tiga tab dengan jumlah dari server; ringkasan periode; yang terbaru di atas; kartu berlabel bacaan lengkap", async () => {
    buka();
    tampil(<Daftar />);
    expect(screen.getByLabelText("Memuat daftar pembayaran")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu verifikasi")).getByText("22")).toBeTruthy(), T);
    expect(within(screen.getByLabelText("Terverifikasi")).getByText("3")).toBeTruthy();
    expect(within(screen.getByLabelText("Ditolak")).getByText("2")).toBeTruthy();
    // Kartu ringkasan periode (angka server) — jumlah per status.
    expect(screen.getByLabelText("Menunggu verifikasi: 22 pembayaran")).toBeTruthy();
    expect(screen.getByLabelText("Terverifikasi: 3 pembayaran")).toBeTruthy();
    expect(screen.getByLabelText("Ditolak: 2 pembayaran")).toBeTruthy();
    const kartu = screen.getAllByLabelText(/^Pembayaran (DP|Cicilan|Pelunasan) order SAN-S5-\d+/);
    expect(kartu[0]?.props.accessibilityLabel).toMatch(/^Pembayaran DP order SAN-S5-0001, Rp.*Ibu Erni, Transfer, .*Menunggu verifikasi, ada bukti$/);
  });

  it("ringkasan periode TIDAK berubah saat pindah tab", async () => {
    buka();
    tampil(<Daftar />);
    await waitFor(() => expect(screen.getByLabelText("Menunggu verifikasi: 22 pembayaran")).toBeTruthy(), T);
    tekan("Terverifikasi");
    await waitFor(() => expect(screen.getByText("Pak Hendra")).toBeTruthy(), T);
    expect(screen.getByLabelText("Menunggu verifikasi: 22 pembayaran")).toBeTruthy();
    expect(screen.getByLabelText("Terverifikasi: 3 pembayaran")).toBeTruthy();
  });

  it("paginasi cursor: halaman pertama 20, 'Muat lebih banyak' menambah sisanya (tanpa duplikat), lalu penutup 'sudah semua'", async () => {
    buka();
    tampil(<Daftar />);
    await waitFor(() => expect(screen.getByLabelText("Muat lebih banyak")).toBeTruthy(), T);
    tekan("Muat lebih banyak");
    await waitFor(() => expect(screen.getByText(/^22 pembayaran · sudah semua/)).toBeTruthy(), T);
    expect(screen.queryByLabelText("Muat lebih banyak")).toBeNull();
  });

  it("pencarian (debounce) menyaring dari server: nama pelanggan, nominal '1.500.000', dan tidak cocok → state kosong dengan atur ulang", async () => {
    buka();
    tampil(<Daftar />);
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu verifikasi")).getByText("22")).toBeTruthy(), T);
    fireEvent.changeText(screen.getByLabelText("Cari pembayaran"), "erni");
    await waitFor(() => expect(screen.getByText(/^2 pembayaran · sudah semua/)).toBeTruthy(), T);
    fireEvent.changeText(screen.getByLabelText("Cari pembayaran"), "1.500.000");
    await waitFor(() => expect(screen.getByText(/^1 pembayaran · sudah semua/)).toBeTruthy(), T);
    fireEvent.changeText(screen.getByLabelText("Cari pembayaran"), "zzzz-tidak-ada");
    await waitFor(() => expect(screen.getByText("Tidak ada yang cocok")).toBeTruthy(), T);
    tekan("Atur ulang");
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu verifikasi")).getByText("22")).toBeTruthy(), T);
    expect((screen.getByLabelText("Cari pembayaran") as { props: { value: string } }).props.value).toBe("");
  });

  it("filter cara bayar: sheet → Tunai → terapkan → hanya tunai; tombol filter memberi tahu jumlah aktif", async () => {
    buka();
    tampil(<Daftar />);
    await waitFor(() => expect(screen.getByLabelText("Filter")).toBeTruthy(), T);
    tekan("Filter");
    expect(screen.getByText("Filter pembayaran")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Tunai")).toBeTruthy(), T);
    tekan("Tunai");
    tekan("Terapkan");
    await waitFor(() => expect(screen.getByText(/^5 pembayaran · sudah semua/)).toBeTruthy(), T);
    expect(screen.getByLabelText("Filter, 1 aktif")).toBeTruthy();
  });

  it("ketuk kartu membuka detail dengan id dari server; tab Ditolak menampilkan status", async () => {
    buka();
    tampil(<Daftar />);
    await waitFor(() => expect(screen.getByLabelText("Ditolak")).toBeTruthy(), T);
    tekan("Ditolak");
    await waitFor(() => expect(screen.getByText("Pak Rudi")).toBeTruthy(), T);
    fireEvent.press(screen.getByLabelText(/^Pembayaran order SAN-S5-\d+, Rp.*Pak Rudi/));
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/pembayaran/[id]", params: { id: expect.stringMatching(/^bayar-/) } });
  });

  it("state: kosong (ramah), server error, sesi habis, offline", async () => {
    buka("kosong");
    const a = tampil(<Daftar />);
    await waitFor(() => expect(screen.getByText("Tidak ada yang menunggu")).toBeTruthy(), T);
    a.unmount();

    buka("galat");
    const b = tampil(<Daftar />);
    await waitFor(() => expect(screen.getByText("Server sedang bermasalah")).toBeTruthy(), T);
    expect(screen.getByLabelText("Coba lagi")).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
    b.unmount();

    buka("sesi");
    const c = tampil(<Daftar />);
    await waitFor(() => expect(screen.getByText("Sesi Anda berakhir")).toBeTruthy(), T);
    c.unmount();

    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    buka("offline");
    tampil(<Daftar />);
    await waitFor(() => expect(screen.getAllByText("Tidak ada koneksi").length).toBeGreaterThan(0), T);
  });

  it("penyegaran (tarik ke bawah) gagal setelah data ada → daftar lama tetap, banner 'Gagal memperbarui'", async () => {
    buka("basi");
    tampil(<Daftar />);
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu verifikasi")).getByText("22")).toBeTruthy(), T);
    const segarkan = async () => {
      const daftar = screen.UNSAFE_getByType(FlatList);
      await act(async () => { (daftar.props.refreshControl as React.ReactElement<{ onRefresh: () => void }>).props.onRefresh(); });
    };
    await segarkan();
    await segarkan();
    await waitFor(() => expect(screen.getByText("Gagal memperbarui")).toBeTruthy(), T);
    expect(within(screen.getByLabelText("Menunggu verifikasi")).getByText("22")).toBeTruthy();
  });

  it("peran tanpa izin baca (financeRead=false): layar ditolak dengan penjelasan; peran baca-saja (owner/approver/akuntan) melihat daftar", async () => {
    buka("normal", "finance@x");
    const p = peranContoh("finance@x");
    if ("tanpaAkses" in p) throw new Error("x");
    useSession.setState({ capabilities: { ...p.capabilities, financeRead: false } });
    const a = tampil(<Daftar />);
    expect(screen.getByText("Anda tidak punya akses")).toBeTruthy();
    expect(screen.queryByLabelText("Cari pembayaran")).toBeNull();
    a.unmount();
    for (const email of ["owner@x", "approver@x", "akuntan@x"]) {
      buka("normal", email);
      const v = tampil(<Daftar />);
      await waitFor(() => expect(within(screen.getByLabelText("Menunggu verifikasi")).getByText("22")).toBeTruthy(), T);
      v.unmount();
    }
  });

  it("'Sembunyikan nominal' menyamarkan pelanggan dan label bacaan (tanpa rupiah)", async () => {
    buka();
    usePrefs.setState({ sembunyikanAngka: true });
    tampil(<Daftar />);
    await waitFor(() => expect(screen.getAllByLabelText("Disamarkan").length).toBeGreaterThan(0), T);
    expect(screen.queryByText("Ibu Erni")).toBeNull();
    for (const k of screen.getAllByLabelText(/^Pembayaran (DP|Cicilan|Pelunasan) order SAN-S5-\d+/)) {
      expect(k.props.accessibilityLabel).not.toMatch(/Rp/);
      expect(k.props.accessibilityLabel).toMatch(/nominal disembunyikan/);
    }
  });
});

describe("Pembayaran: titik masuk", () => {
  it("kartu 'Pembayaran pelanggan' di tab Transaksi membuka layar pembayaran (bukan segmen lokal)", async () => {
    buka();
    tampil(<Transaksi />);
    await waitFor(() => expect(screen.getByLabelText(/^Pembayaran pelanggan/)).toBeTruthy(), T);
    fireEvent.press(screen.getByLabelText(/^Pembayaran pelanggan/));
    expect(router.__push).toHaveBeenCalledWith("/pembayaran");
  });
});

describe("Pembayaran: detail", () => {
  it("memuat order, invoice, pelanggan, jenis, cara bayar, rekening tujuan, pencatat, bukti, riwayat, dan jujur soal field yang tidak tercatat", async () => {
    bukaDetail("bayar-1");
    await tunda1();
    expect(screen.getByText(/^Pembayaran DP · SAN-S5-0001/)).toBeTruthy();
    expect(screen.getAllByText("Ibu Erni").length).toBeGreaterThan(0);
    expect(screen.getByText(/^INV-.* · Terkirim/)).toBeTruthy();
    expect(screen.getByText("SANOBANK Kemal")).toBeTruthy();
    expect(screen.getByText("Risel")).toBeTruthy();
    expect(screen.getByText("Belum bayar")).toBeTruthy(); // status bayar order di CRM
    // Field yang memang tidak ada di model Payment dinyatakan jujur — bukan dikosongkan diam-diam.
    expect(screen.getAllByText("Tidak tercatat di sistem")).toHaveLength(3);
    expect(screen.getByText("Nomor referensi")).toBeTruthy();
    expect(screen.getByText("Pengirim / nama di bukti")).toBeTruthy();
    // Tagihan, alokasi, jurnal, bukti gambar, riwayat.
    expect(screen.getByText("Tagihan order")).toBeTruthy();
    expect(screen.getByText("Sisa jika pembayaran ini ikut dihitung")).toBeTruthy(); // belum terhitung → baris ini relevan
    expect(screen.getByText(/Tanpa alokasi khusus/)).toBeTruthy();
    expect(screen.getByText(/JU-\d+ · Terbukukan/)).toBeTruthy();
    expect(screen.getByLabelText("Buka foto lampiran 1")).toBeTruthy();
    expect(screen.getByText(/^Dicatat · Risel/)).toBeTruthy();
    expect(screen.getAllByLabelText("Verifikasi")[0]?.props.accessibilityState.disabled).toBe(false);
    expect(screen.getByLabelText("Tolak").props.accessibilityState.disabled).toBe(false);
  });

  it("alokasi ke beberapa order ditampilkan per order", async () => {
    bukaDetail("bayar-7");
    await tunda1();
    expect(screen.getByText("Order SAN-S5-0001")).toBeTruthy();
    expect(screen.getByText("Order SAN-S5-0002")).toBeTruthy();
    expect(screen.queryByText(/Tanpa alokasi khusus/)).toBeNull();
  });

  it("pembayaran tunai saat pengiriman: sumber disebut, dan tidak ada bukti foto (bukan peringatan)", async () => {
    bukaDetail("bayar-3");
    await tunda1();
    expect(screen.getByText(/Apriansyah \(saat pengiriman\)/)).toBeTruthy();
    expect(screen.getByText("Pembayaran tunai — tidak ada foto bukti.")).toBeTruthy();
  });

  it("peringatan server (tanpa bukti, kelebihan bayar, kemungkinan ganda) tampil; server TIDAK memblokir, jadi tombol tetap aktif", async () => {
    bukaDetail("bayar-4");
    await tunda1();
    expect(screen.getAllByText("Belum ada bukti pembayaran terlampir.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Sistem tidak memblokir verifikasi/)).toBeTruthy();
    expect(screen.getAllByLabelText("Verifikasi")[0]?.props.accessibilityState.disabled).toBe(false);

    screen.unmount();
    bukaDetail("bayar-5");
    await tunda1();
    expect(screen.getByText("Nominal lebih besar dari nilai order.")).toBeTruthy();
    expect(screen.getByText(/kelebihan bayar\)\. Sistem tidak punya aturan khusus/)).toBeTruthy();

    screen.unmount();
    bukaDetail("bayar-6");
    await tunda1();
    expect(screen.getByText(/Ada 1 pembayaran lain untuk order yang sama/)).toBeTruthy();
  });

  it("nominal & nama pelanggan sangat panjang tetap terbaca (tidak melempar)", async () => {
    bukaDetail("bayar-8");
    await tunda1();
    expect(screen.getAllByText(/PT Sinar Abadi Sejahtera Bersama Nusantara Raya Indonesia/).length).toBeGreaterThan(0);
  });

  it("bukti PDF: tombol 'Buka PDF' membuka tautan bertanda-tangan di penampil perangkat", async () => {
    const buka_ = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    bukaDetail("bayar-2");
    await tunda1();
    tekan("Buka PDF");
    await waitFor(() => expect(buka_).toHaveBeenCalledTimes(1), T);
    expect(buka_.mock.calls[0]?.[0]).toMatch(/\/media\/bukti-pembayaran\/bukti-2\.pdf\?exp=\d+&sig=/);
  });

  it("bukti PDF kedaluwarsa → tidak dibuka; detail dimuat ulang untuk tautan baru", async () => {
    const buka_ = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const muatUlang = jest.fn();
    tampil(<BuktiPembayaran bukti={{ jenis: "pdf", url: "/media/bukti-pembayaran/x.pdf?exp=1&sig=a", thumbUrl: null, kedaluwarsa: "2020-01-01T00:00:00.000Z" }} ada tunai={false} onMuatUlang={muatUlang} />);
    tekan("Buka PDF");
    await waitFor(() => expect(muatUlang).toHaveBeenCalledTimes(1), T);
    expect(buka_).not.toHaveBeenCalled();
    expect(screen.getByText(/Tautan bukti sudah kedaluwarsa/)).toBeTruthy();
  });

  it("PDF gagal dibuka (tanpa penampil) → pesan Indonesia, tidak crash", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no activity"));
    bukaDetail("bayar-2");
    await tunda1();
    tekan("Buka PDF");
    await waitFor(() => expect(screen.getByText(/PDF tidak bisa dibuka/)).toBeTruthy(), T);
  });

  it("dokumen tidak ada → state kosong dengan tombol kembali", async () => {
    bukaDetail("tidak-ada");
    await waitFor(() => expect(screen.getByText("Pembayaran tidak ditemukan")).toBeTruthy(), T);
  });

  it("'Sembunyikan nominal': pelanggan dan bukti disamarkan; nominal di konfirmasi disamarkan", async () => {
    usePrefs.setState({ sembunyikanAngka: true });
    bukaDetail("bayar-1");
    await tunda1();
    expect(screen.getByLabelText("Bukti pembayaran disembunyikan")).toBeTruthy();
    expect(screen.queryByLabelText("Buka foto lampiran 1")).toBeNull();
    expect(screen.queryByText("Ibu Erni")).toBeNull();
    tekan("Verifikasi");
    expect(screen.getAllByLabelText("Nominal disembunyikan").length).toBeGreaterThan(0);
  });
});

describe("Pembayaran: verifikasi & penolakan", () => {
  it("verifikasi: konfirmasi → step-up lolos → status resmi diambil ulang (Terverifikasi), tombol hilang, status bayar order ikut dari server", async () => {
    bukaDetail("bayar-1");
    await tunda1();
    tekan("Verifikasi");
    expect(screen.getByText("Verifikasi pembayaran?")).toBeTruthy();
    konfirmasiVerifikasi();
    await waitFor(() => expect(screen.getByText(/Pembayaran diverifikasi\. Status resmi dimuat dari server/)).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByText(/Sudah diverifikasi oleh Natasha/)).toBeTruthy(), T);
    expect(screen.queryAllByLabelText("Verifikasi")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Tolak")).toHaveLength(0);
    expect(screen.getByText("DP (sebagian)")).toBeTruthy();
    expect(screen.getByText(/^Diverifikasi · Natasha/)).toBeTruthy();
  });

  it("tolak: alasan kosong / terlalu pendek menonaktifkan tombol; alasan sah → Ditolak, alasan tampil, jurnal dibalik", async () => {
    bukaDetail("bayar-4");
    await tunda1();
    tekan("Tolak");
    expect(screen.getAllByText("Tolak pembayaran").length).toBeGreaterThan(0); // judul lembar + tombol
    expect(screen.getByLabelText("Tolak pembayaran").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/Alasan wajib diisi/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Alasan penolakan"), "  ab ");
    expect(screen.getByLabelText("Tolak pembayaran").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Alasan penolakan"), "Uang belum masuk di mutasi");
    expect(screen.getByLabelText("Tolak pembayaran").props.accessibilityState.disabled).toBe(false);
    tekan("Tolak pembayaran");
    await waitFor(() => expect(screen.getByText(/Pembayaran ditolak\. Jurnal dibalik dan alasan tercatat/)).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByText(/Sudah ditolak oleh Natasha/)).toBeTruthy(), T);
    expect(screen.getAllByText(/Uang belum masuk di mutasi/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Jurnal penerimaan dibalik/)).toBeTruthy();
    expect(screen.queryAllByLabelText("Verifikasi")).toHaveLength(0);
  });

  it("double-tap pada konfirmasi → hanya SATU perintah terkirim ke server", async () => {
    const kirim = jest.spyOn(mockBayar, "mockPutuskanBayar");
    bukaDetail("bayar-1");
    await tunda1();
    tekan("Verifikasi");
    const tombol = semuaLabel("Verifikasi").at(-1) as never;
    fireEvent.press(tombol);
    fireEvent.press(tombol);
    await waitFor(() => expect(screen.getByText(/Sudah diverifikasi oleh Natasha/)).toBeTruthy(), T);
    expect(kirim).toHaveBeenCalledTimes(1);
  });

  it("step-up dibatalkan → tidak ada perintah, tidak ada pesan galat; tolak: alasan yang sudah ditulis tidak hilang", async () => {
    const kirim = jest.spyOn(mockBayar, "mockPutuskanBayar");
    jest.spyOn(useLock.getState(), "requireStepUp").mockResolvedValue(false);
    bukaDetail("bayar-1");
    await tunda1();
    tekan("Tolak");
    fireEvent.changeText(screen.getByLabelText("Alasan penolakan"), "Salah catat nominal");
    tekan("Tolak pembayaran");
    await waitFor(() => expect((screen.getByLabelText("Alasan penolakan") as { props: { value: string } }).props.value).toBe("Salah catat nominal"), T);
    expect(kirim).not.toHaveBeenCalled();
    expect(screen.queryByText(/Konfirmasi dibatalkan/)).toBeNull();
    expect(screen.queryByText(/ditolak\./)).toBeNull();
  });

  it.each([["owner@x"], ["approver@x"], ["akuntan@x"]])("%s: hanya membaca — tombol nonaktif dengan alasan dari server (PAYMENT_WRITE khusus FINANCE)", async (email) => {
    bukaDetail("bayar-1", "normal", email);
    await tunda1();
    expect(screen.getAllByLabelText("Verifikasi")[0]?.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Tolak").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("Akun Anda tidak punya izin memverifikasi pembayaran.")).toBeTruthy();
  });

  it("pembayaran yang sudah diverifikasi tidak menawarkan tombol apa pun; yang dibatalkan tampil sebagai Dibatalkan", async () => {
    bukaDetail("bayar-9");
    await tunda1();
    expect(screen.getByText(/Sudah diverifikasi oleh Finance Lain/)).toBeTruthy();
    expect(screen.queryAllByLabelText("Verifikasi")).toHaveLength(0);
    screen.unmount();
    bukaDetail("bayar-14");
    await waitFor(() => expect(screen.getByText(/Sudah dibatalkan oleh Finance Lain/)).toBeTruthy(), T);
    expect(screen.getAllByText("Dibatalkan").length).toBeGreaterThan(0);
  });

  it("konflik (409): sudah diverifikasi Finance lain → pesan server + status terbaru dimuat ulang, tanpa retry otomatis", async () => {
    bukaDetail("bayar-1", "konflik");
    await tunda1();
    tekan("Verifikasi");
    konfirmasiVerifikasi();
    await waitFor(() => expect(screen.getByText(/sudah diverifikasi oleh Finance Lain\. Status terbaru dimuat ulang/)).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByText(/^Sudah diverifikasi oleh Finance Lain$/)).toBeTruthy(), T);
    expect(screen.queryAllByLabelText("Verifikasi")).toHaveLength(0);
  });

  it("izin dicabut (403): pesan 'Izin Anda berubah'", async () => {
    bukaDetail("bayar-1", "izin");
    await tunda1();
    tekan("Verifikasi");
    konfirmasiVerifikasi();
    await waitFor(() => expect(screen.getByText(/Izin Anda berubah/)).toBeTruthy(), T);
  });

  it("hasil tidak pasti (putus setelah kirim): pesan 'belum pasti', bukan sukses palsu; tombol tetap bisa dicoba lagi", async () => {
    bukaDetail("bayar-1", "putus");
    await tunda1();
    tekan("Verifikasi");
    konfirmasiVerifikasi();
    await waitFor(() => expect(screen.getByText(/hasilnya belum pasti/)).toBeTruthy(), T);
    expect(screen.queryByText(/Pembayaran diverifikasi\./)).toBeNull();
    expect(screen.getAllByLabelText("Verifikasi")[0]?.props.accessibilityState.disabled).toBe(false);
  });

  it("server error (500): pesan generik tanpa detail teknis", async () => {
    bukaDetail("bayar-1", "normal");
    await tunda1();
    jest.spyOn(mockBayar, "mockPutuskanBayar").mockRejectedValue(new ApiError({ status: 500, code: "INTERNAL", message: "stack rahasia" }));
    tekan("Verifikasi");
    konfirmasiVerifikasi();
    await waitFor(() => expect(screen.getByText(/Server sedang bermasalah/)).toBeTruthy(), T);
    expect(screen.queryByText(/stack rahasia/)).toBeNull();
  });

  it("offline: tombol nonaktif dengan penjelasan; perintah tidak dikirim/antre", async () => {
    const kirim = jest.spyOn(mockBayar, "mockPutuskanBayar");
    bukaDetail("bayar-1");
    await tunda1();
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    await act(async () => { screen.rerender(<Detail />); });
    expect(screen.getByText("Butuh koneksi internet")).toBeTruthy();
    expect(screen.getAllByLabelText("Verifikasi")[0]?.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Tolak").props.accessibilityState.disabled).toBe(true);
    expect(kirim).not.toHaveBeenCalled();
  });
});

/** Tunggu sampai detail selesai dimuat (kicker "Pembayaran … · <order>" tampil). */
async function tunda1() {
  await waitFor(() => expect(screen.getByText(/^Pembayaran( DP| Cicilan| Pelunasan)? · /)).toBeTruthy(), T);
}
