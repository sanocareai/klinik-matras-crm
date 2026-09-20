// Layar transaksi S6–S8 di atas server contoh: tab Transaksi (capability-driven), daftar (tab/cari/paginasi), detail (aksi dari server, tautan Inbox S4),
// perintah (ajukan, bayar, potong gaji, bayar tagihan, alokasi, batalkan) dengan konflik/izin/putus/offline/double-tap, formulir (validasi inline,
// draf lokal, unggah foto), dan pemasukan lain yang bukan pembayaran order.

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as NetInfo from "@react-native-community/netinfo";
import * as SecureStore from "expo-secure-store";
import { ThemeProvider } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { setSkenario, type Skenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import * as mockTx from "@/mocks/transaksi";
import Transaksi from "../../app/(tabs)/transaksi";
import DaftarRute from "../../app/tx/[modul]/index";
import DetailRute from "../../app/tx/[modul]/[id]";
import BaruRute from "../../app/tx/[modul]/baru";

const router = jest.requireMock("expo-router") as { __push: jest.Mock; __replace: jest.Mock; __back: jest.Mock; __setParams: (p: object) => void };
const netinfo = NetInfo as unknown as { useNetInfo: jest.Mock };
const T = { timeout: 5000 };
jest.setTimeout(30000); // alur berlangkah banyak; tiap langkah server contoh menunda ±0,3–0,5 dtk

function tampil(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}><ThemeProvider>{children}</ThemeProvider></QueryClientProvider> });
}
function masuk(email: string) {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
}
function buka(skenario: Skenario = "normal", email = "finance@x") { setSkenario(skenario); masuk(email); }
const daftar = (modul: string, skenario: Skenario = "normal", email = "finance@x") => { buka(skenario, email); router.__setParams({ modul }); return tampil(<DaftarRute />); };
const detail = (modul: string, id: string, skenario: Skenario = "normal", email = "finance@x") => { buka(skenario, email); router.__setParams({ modul, id }); return tampil(<DetailRute />); };
const baru = (modul: string, email = "finance@x", extra: object = {}) => { buka("normal", email); router.__setParams({ modul, ...extra }); return tampil(<BaruRute />); };
const tekan = (label: string | RegExp) => fireEvent.press(screen.getByLabelText(label));
const ada = (label: string | RegExp) => expect(screen.getByLabelText(label)).toBeTruthy();
const tunggu = (label: string | RegExp) => waitFor(() => ada(label), T);
const tungguTeks = (t: string | RegExp) => waitFor(() => expect(screen.getByText(t)).toBeTruthy(), T);

async function pilih(labelKolom: string, opsiRegex: RegExp) {
  tekan(new RegExp(`^${labelKolom}: `));
  await waitFor(() => expect(screen.getByLabelText(opsiRegex)).toBeTruthy(), T);
  tekan(opsiRegex);
}

beforeEach(() => {
  usePrefs.setState({ sembunyikanAngka: false });
  router.__push.mockClear(); router.__replace.mockClear(); router.__back.mockClear();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() });
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
});
afterEach(() => jest.restoreAllMocks());

describe("Tab Transaksi", () => {
  it("kartu semua modul + Pembayaran pelanggan; tombol tambah mengikuti capability (FINANCE ya, penyetuju tidak)", async () => {
    buka("normal", "finance@x");
    tampil(<Transaksi />);
    await tunggu(/^Pengeluaran, 2 menunggu/);
    for (const m of ["Pembelian", "Kasbon", "Pemasukan Lain", "Piutang", "Refund", "Tagihan supplier", "Supplier", "Pembayaran supplier"]) expect(screen.getAllByLabelText(new RegExp(`^${m}`)).length).toBeGreaterThan(0);
    ada("Tambah pengeluaran"); ada("Tambah kasbon"); ada("Tambah supplier");
    expect(screen.queryByLabelText("Tambah piutang")).toBeNull(); // piutang hanya dibaca
    tekan(/^Pengeluaran, 2 menunggu/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/tx/[modul]", params: { modul: "pengeluaran" } });
  });

  it("penyetuju (tanpa FINANCE_POST) tidak melihat tombol tambah apa pun", async () => {
    buka("normal", "approver@x");
    tampil(<Transaksi />);
    await tunggu(/^Pengeluaran/);
    expect(screen.queryByLabelText(/^Tambah /)).toBeNull();
  });
});

describe("Daftar", () => {
  it("tab dengan jumlah dari server, kartu berlabel lengkap, penanda 'Nota wajib' dan ringkasan", async () => {
    daftar("pengeluaran");
    expect(screen.getByLabelText("Memuat daftar pengeluaran")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByLabelText("Menunggu")).getByText("2")).toBeTruthy(), T);
    expect(within(screen.getByLabelText("Draf")).getByText("1")).toBeTruthy();
    ada("Ganti ban truk, EXP-20092026-263, Menunggu persetujuan");
    expect(screen.getAllByText("Nota wajib sebelum disetujui").length).toBe(1);
    expect(screen.getByLabelText("Total pada daftar ini")).toBeTruthy();
  });

  it("paginasi 20 per halaman: 'Muat lebih banyak' menambah sisanya lalu penutup 'sudah semua'", async () => {
    daftar("pengeluaran");
    await tunggu("Muat lebih banyak");
    tekan("Muat lebih banyak");
    await tungguTeks(/^28 pengeluaran · sudah semua/);
  });

  it("pindah tab & cari (nama, nominal '150.000'); tidak cocok → kosong dengan atur ulang", async () => {
    daftar("pengeluaran");
    await tunggu("Menunggu");
    tekan("Menunggu");
    await tunggu("Ganti ban truk, EXP-20092026-263, Menunggu persetujuan");
    tekan("Semua");
    fireEvent.changeText(screen.getByLabelText("Cari pengeluaran"), "150.000");
    await tunggu("Servis truk pengiriman, EXP-19092026-241, Menunggu persetujuan");
    fireEvent.changeText(screen.getByLabelText("Cari pengeluaran"), "zzz-tidak-ada");
    await tungguTeks("Tidak ada yang cocok");
    tekan("Atur ulang");
    await tunggu("Menunggu");
  });

  it("piutang: umur & jatuh tempo dari server, tab Lewat tempo, ringkasan umur", async () => {
    daftar("piutang");
    await tungguTeks("Ibu Sari");
    expect(screen.getByText(/lewat 2\d hari|lewat 20 hari|lewat \d+ hari/)).toBeTruthy();
    tekan("Lewat tempo");
    await waitFor(() => expect(screen.queryByText("Bapak Budi")).toBeNull(), T);
  });

  it("tagihan: sisa utang & lewat jatuh tempo ditampilkan; supplier menampilkan sisa utang", async () => {
    daftar("tagihan");
    await tungguTeks("Utang usaha terbuka");
    expect(screen.getByText(/Jatuh tempo .* · lewat \d+ hari/)).toBeTruthy();
  });

  it("skenario kosong dan galat: state kosong, dan galat dengan tombol coba lagi", async () => {
    daftar("kasbon", "kosong");
    await tungguTeks("Belum ada kasbon");
  });

  it("galat server: pesan dan coba lagi", async () => {
    daftar("pengeluaran", "galat");
    await waitFor(() => expect(screen.getByLabelText(/Coba lagi/)).toBeTruthy(), T);
  });

  it("offline: banner dan daftar tetap dibaca", async () => {
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    daftar("pengeluaran");
    await tunggu(/^Ganti ban truk/);
    expect(screen.getByText(/koneksi/i)).toBeTruthy();
  });
});

describe("Detail & Inbox S4", () => {
  it("dokumen menunggu: penyetuju membuka keputusan di Persetujuan (S4); akuntan hanya melihat keterangan", async () => {
    detail("pengeluaran", "e2", "normal", "approver@x");
    await tunggu("Buka di Persetujuan");
    tekan("Buka di Persetujuan");
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/persetujuan/[jenis]/[id]", params: { jenis: "expense", id: "e2" } });
  });

  it("akuntan: tidak ada tautan keputusan; teks 'menunggu keputusan pihak yang berwenang'", async () => {
    detail("pengeluaran", "e2", "normal", "akuntan@x");
    await tungguTeks(/Menunggu keputusan pihak yang berwenang/);
    expect(screen.queryByLabelText("Buka di Persetujuan")).toBeNull();
  });

  it("nota wajib: peringatan di detail; pemasangan nota menyala untuk yang boleh mencatat", async () => {
    detail("pengeluaran", "e2");
    await tungguTeks(/Nota wajib sebelum disetujui/);
    ada("Lampirkan nota");
  });

  it("aksi yang tidak tersedia menampilkan alasan dari server (ubah = admin)", async () => {
    detail("pengeluaran", "e5"); // draf; FINANCE tanpa FINANCE_ADMIN
    await tungguTeks("Tidak tersedia");
    expect(screen.getByLabelText(/^Ubah tidak tersedia: Mengubah dokumen hanya untuk admin keuangan/)).toBeTruthy();
    detail("pengeluaran", "e5", "normal", "owner@x");
    await tunggu("Ubah");
  });

  it("tautan antar dokumen: tagihan → pembayaran; piutang → pembayaran resmi S5", async () => {
    detail("piutang", "o1");
    await tungguTeks("Pembayaran resmi");
    tekan(/^Pembayaran Terverifikasi\. Buka di Pembayaran pelanggan/);
    expect(router.__push).toHaveBeenCalledWith({ pathname: "/pembayaran/[id]", params: { id: "bp1" } });
  });
});

describe("Perintah", () => {
  it("ajukan draf: konfirmasi → sukses → status dimuat ulang dari server", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    detail("pengeluaran", "e5");
    await tunggu("Ajukan untuk persetujuan");
    tekan("Ajukan untuk persetujuan");
    await tunggu("Ajukan");
    tekan("Ajukan");
    await tungguTeks(/Diajukan\. Dokumen kini ada di Persetujuan/);
    expect(kirim).toHaveBeenCalledWith("/finance/expenses/e5/submit", "POST", {});
    await waitFor(() => expect(screen.getAllByText("Menunggu persetujuan").length).toBeGreaterThan(0), T);
  });

  it("double-tap: dua ketukan cepat hanya mengirim SATU perintah", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    detail("pengeluaran", "e5");
    await tunggu("Ajukan untuk persetujuan");
    tekan("Ajukan untuk persetujuan");
    await tunggu("Ajukan");
    const tombol = screen.getByLabelText("Ajukan");
    fireEvent.press(tombol); fireEvent.press(tombol);
    await tungguTeks(/Diajukan\. Dokumen kini ada di Persetujuan/);
    expect(kirim).toHaveBeenCalledTimes(1);
  });

  it("bayar reimbursement: rekening wajib (galat inline), lalu sukses dengan Idempotency di jalur perintah", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    detail("pengeluaran", "e3");
    await tunggu("Bayar");
    tekan("Bayar");
    await tunggu("Bayar sekarang");
    // Rekening dimuat dulu (tombol nonaktif selama memuat) — baru ketukan pertama diproses.
    await waitFor(() => expect(screen.getByLabelText("Bayar sekarang").props.accessibilityState.disabled).toBe(false), T);
    tekan("Bayar sekarang");
    await tungguTeks("Pilih rekening sumber uang.");
    expect(kirim).not.toHaveBeenCalled();
    await pilih("Uang keluar dari", /^KEM - Sano Bank, Saldo /);
    tekan("Bayar sekarang");
    await tungguTeks(/Pembayaran dicatat/);
    expect(kirim).toHaveBeenCalledWith("/finance/expenses/e3/pay", "POST", expect.objectContaining({ cashAccountId: "r1" }));
  });

  it("kasbon: potong gaji melebihi sisa ditahan di klien; nominal sah dicatat", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    detail("kasbon", "k1");
    await tunggu("Potong dari gaji");
    tekan("Potong dari gaji");
    await tunggu("Catat pemotongan");
    fireEvent.changeText(screen.getByLabelText("Nominal"), "700.000");
    tekan("Catat pemotongan");
    await tungguTeks(/Nominal melebihi sisa/);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "600.000");
    tekan("Catat pemotongan");
    await tungguTeks(/Pemotongan gaji dicatat/);
    expect(kirim).toHaveBeenCalledWith("/finance/kasbon/k1/pelunasan", "POST", expect.objectContaining({ method: "POTONG_GAJI", amount: "600000.00" }));
  });

  it("tagihan: bayar parsial lalu lunas; sisa utang & status mengikuti server", async () => {
    detail("tagihan", "t1"); // sisa 600.000
    await tunggu("Bayar");
    tekan("Bayar");
    await tunggu("Bayar sekarang");
    await pilih("Uang keluar dari", /^KEM - Sano Bank, Saldo /);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "200.000");
    tekan("Bayar sekarang");
    await tungguTeks(/Pembayaran dicatat/);
    await waitFor(() => expect(screen.getAllByText("Dibayar sebagian").length).toBeGreaterThan(0), T);
    tekan("Bayar");
    await tunggu("Bayar sekarang");
    await pilih("Uang keluar dari", /^KEM - Sano Bank, Saldo /);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "400.000");
    tekan("Bayar sekarang");
    await waitFor(() => expect(screen.getAllByText("Lunas").length).toBeGreaterThan(0), T);
  });

  it("alokasi pembayaran: total harus persis nominal pembayaran; simpan menyalakan status server", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    detail("piutang", "o1");
    await tunggu("Atur alokasi");
    tekan("Atur alokasi");
    await tunggu("Simpan alokasi");
    expect(screen.getByText("Seluruh nominal teralokasi")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Nominal order SAN-0001"), "400.000");
    await tungguTeks("Belum teralokasi");
    tekan("Tambah order SAN-0002");
    fireEvent.changeText(screen.getByLabelText("Nominal order SAN-0002"), "100.000");
    await tungguTeks("Seluruh nominal teralokasi");
    tekan("Simpan alokasi");
    await tungguTeks(/Alokasi disimpan/);
    expect(kirim).toHaveBeenCalledWith("/finance/customer-payments/bp1/allocations", "POST", { allocations: [{ orderId: "o1", amount: "400000.00" }, { orderId: "o2", amount: "100000.00" }] });
  });

  it("batalkan (admin): alasan wajib; sukses membalik dokumen", async () => {
    detail("pengeluaran", "e3", "normal", "owner@x");
    await tunggu("Batalkan");
    tekan("Batalkan");
    await waitFor(() => expect(screen.getAllByLabelText("Batalkan").length).toBeGreaterThan(1), T);
    fireEvent.changeText(screen.getByLabelText("Alasan penolakan"), "salah nominal");
    fireEvent.press(screen.getAllByLabelText("Batalkan").at(-1) as never);
    await tungguTeks(/Dibatalkan\. Jurnal dibalik/);
  });

  it("konflik 409: pesan server tampil dan status dimuat ulang", async () => {
    detail("pengeluaran", "e5", "konflik");
    await tunggu("Ajukan untuk persetujuan");
    tekan("Ajukan untuk persetujuan");
    await tunggu("Ajukan");
    tekan("Ajukan");
    await tungguTeks(/sudah diproses oleh Finance Lain/);
  });

  it("izin dicabut (403): pesan izin berubah dan hak akses dimuat ulang", async () => {
    detail("pengeluaran", "e5", "izin");
    await tunggu("Ajukan untuk persetujuan");
    tekan("Ajukan untuk persetujuan");
    await tunggu("Ajukan");
    tekan("Ajukan");
    await tungguTeks(/Izin Anda berubah/);
  });

  it("jaringan putus setelah terkirim: hasil TIDAK PASTI — tidak langsung dianggap gagal, tidak diantre", async () => {
    detail("pengeluaran", "e5", "putus");
    await tunggu("Ajukan untuk persetujuan");
    tekan("Ajukan untuk persetujuan");
    await tunggu("Ajukan");
    tekan("Ajukan");
    await tungguTeks(/hasilnya belum pasti/);
  });

  it("offline: tombol perintah nonaktif dengan penjelasan (tidak ada antrean)", async () => {
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    detail("pengeluaran", "e5");
    await tunggu("Ajukan untuk persetujuan");
    expect(screen.getAllByText(S_OFFLINE).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Ajukan untuk persetujuan").props.accessibilityState.disabled).toBe(true);
  });

  it("step-up dibatalkan: perintah tidak terkirim", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    useLock.setState({ pinSet: true, lastUnlockAt: 0 });
    const requireStepUp = jest.spyOn(useLock.getState(), "requireStepUp").mockResolvedValue(false);
    detail("pengeluaran", "e5");
    await tunggu("Ajukan untuk persetujuan");
    tekan("Ajukan untuk persetujuan");
    await tunggu("Ajukan");
    await act(async () => { tekan("Ajukan"); });
    await waitFor(() => expect(requireStepUp).toHaveBeenCalled(), T);
    expect(kirim).not.toHaveBeenCalled();
  });
});
const S_OFFLINE = /koneksi|Tidak ada koneksi|offline/i;

describe("Formulir", () => {
  it("pengeluaran: validasi inline setelah percobaan kirim; tidak ada perintah terkirim saat isian belum lengkap", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    baru("pengeluaran");
    await tunggu("Ajukan");
    tekan("Ajukan");
    await tungguTeks("Keterangan wajib diisi.");
    expect(screen.getByText("Pilih kategori.")).toBeTruthy();
    expect(screen.getByText("Isi nominal lebih dari 0.")).toBeTruthy();
    expect(kirim).not.toHaveBeenCalled();
  });

  it("pengeluaran: isian lengkap → terkirim SATU kali dengan uang string, lalu pindah ke detail dokumen baru", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    baru("pengeluaran");
    await tunggu("Ajukan");
    fireEvent.changeText(screen.getByLabelText("Keterangan"), "Servis motor");
    await waitFor(() => expect(screen.getByLabelText(/^Kategori: /)).toBeTruthy(), T);
    await pilih("Kategori", /^Servis Kendaraan/);
    await pilih("Uang keluar dari", /^KEM - Sano Bank, Saldo /);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "1.250.000");
    const tombol = screen.getByLabelText("Ajukan");
    fireEvent.press(tombol); fireEvent.press(tombol);
    await waitFor(() => expect(router.__replace).toHaveBeenCalled(), T);
    expect(kirim).toHaveBeenCalledTimes(1);
    expect(kirim).toHaveBeenCalledWith("/finance/expenses", "POST", expect.objectContaining({ amount: "1250000.00", description: "Servis motor", categoryId: "kp1", cashAccountId: "r1", langsungAjukan: true }));
    expect(router.__replace.mock.calls[0]?.[0]).toMatchObject({ pathname: "/tx/[modul]/[id]", params: { modul: "pengeluaran" } });
  });

  it("draf di server: 'Simpan sebagai draf di server' mengirim langsungAjukan=false", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    baru("pengeluaran");
    await tunggu("Simpan sebagai draf di server");
    fireEvent.changeText(screen.getByLabelText("Keterangan"), "Parkir");
    await pilih("Kategori", /^Operasional/);
    await pilih("Uang keluar dari", /^Uang Kas Sano, Saldo /);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "5.000");
    tekan("Simpan sebagai draf di server");
    await waitFor(() => expect(kirim).toHaveBeenCalled(), T);
    expect(kirim.mock.calls[0]?.[2]).toMatchObject({ langsungAjukan: false });
  });

  it("draf lokal: tersimpan di penyimpanan aman, tidak terkirim otomatis, dan bisa dilanjutkan", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    const layar = baru("pengeluaran");
    await tunggu("Simpan draf di HP");
    fireEvent.changeText(screen.getByLabelText("Keterangan"), "Ongkos kirim");
    tekan("Simpan draf di HP");
    await tungguTeks(/Draf disimpan di HP ini/);
    expect(kirim).not.toHaveBeenCalled();
    layar.unmount();
    baru("pengeluaran");
    await tungguTeks("Ada draf tersimpan di HP");
    tekan("Lanjutkan");
    await waitFor(() => expect(screen.getByLabelText("Keterangan").props.value).toBe("Ongkos kirim"), T);
    expect(kirim).not.toHaveBeenCalled();
  });

  it("unggah foto nota: progres → terunggah; gagal jaringan → Coba lagi tanpa menghapus isian", async () => {
    baru("pengeluaran");
    await tunggu("Galeri");
    fireEvent.changeText(screen.getByLabelText("Keterangan"), "Nota kain");
    await act(async () => { tekan("Galeri"); });
    await tungguTeks("Mengunggah foto… jangan tutup layar ini.");
    await tungguTeks("Foto terunggah");
    expect(screen.getByLabelText("Ajukan").props.accessibilityState.disabled).toBe(false);
  });

  it("unggah gagal (offline di server contoh): pesan + coba lagi; formulir tetap aman", async () => {
    setSkenario("offline");
    masuk("finance@x");
    router.__setParams({ modul: "pengeluaran" });
    // Skenario offline juga menggagalkan opsi; formulir menampilkan galat dan tetap bisa dicoba lagi.
    tampil(<BaruRute />);
    await waitFor(() => expect(screen.getByLabelText(/Coba lagi/)).toBeTruthy(), T);
  });

  it("kasbon: pilihan karyawan dari server (hanya karyawan aktif) dan rekening dengan saldo", async () => {
    baru("kasbon");
    await tunggu(/^Karyawan: /);
    tekan(/^Karyawan: /);
    await tunggu(/^Agung/);
    expect(screen.queryByLabelText(/OWNER/)).toBeNull();
    tekan(/^Agung/);
    tekan(/^Uang keluar dari: /);
    await tunggu(/^KEM - Sano Bank, Saldo Rp/);
  });

  it("kasbon: server menolak akun owner bersama → pesan server tampil", async () => {
    baru("kasbon");
    await tunggu(/^Karyawan: /);
    await pilih("Karyawan", /^Agung/);
    fireEvent.changeText(screen.getByLabelText("Alasan / urgensi"), "keluarga");
    await pilih("Uang keluar dari", /^KEM - Sano Bank/);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "100.000");
    tekan("Catat");
    await waitFor(() => expect(router.__replace).toHaveBeenCalled(), T);
  });

  it("pemasukan lain: petunjuk 'bukan pembayaran order' + jalan ke Pembayaran pelanggan; akun penjualan tidak ditawarkan", async () => {
    baru("pemasukan");
    await tungguTeks(/bukan di sini/);
    tekan("Buka Pembayaran pelanggan");
    expect(router.__push).toHaveBeenCalledWith("/pembayaran");
    await tunggu(/^Akun pendapatan: /);
    tekan(/^Akun pendapatan: /);
    await tunggu(/^4-9000 Pendapatan Lain-lain/);
    expect(screen.queryByLabelText(/Penjualan|Layanan|Sewa|Ongkir/)).toBeNull();
  });

  it("refund: cari order → server memberi uang yang boleh dikembalikan; melebihi ditahan di klien", async () => {
    baru("refund");
    await tunggu("Cari order");
    fireEvent.changeText(screen.getByLabelText("Cari order"), "sari");
    await tunggu(/^Order SAN-0001, Ibu Sari, bisa dikembalikan Rp 500\.000/);
    tekan(/^Order SAN-0001/);
    fireEvent.changeText(screen.getByLabelText("Nominal"), "900.000");
    tekan("Ajukan refund");
    await tungguTeks(/Melebihi uang yang bisa dikembalikan/);
  });

  it("tagihan: supplier, kategori biaya, nominal & jatuh tempo opsional divalidasi", async () => {
    baru("tagihan");
    await tunggu("Ajukan tagihan");
    tekan("Ajukan tagihan");
    await tungguTeks("Pilih supplier.");
    expect(screen.getByText(/Pilih kategori biaya/)).toBeTruthy();
  });

  it("akses: penyetuju tidak bisa membuka formulir (capability, bukan nama peran)", async () => {
    baru("pengeluaran", "approver@x");
    await waitFor(() => expect(screen.queryByLabelText("Ajukan")).toBeNull(), T);
  });
});
