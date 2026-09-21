// Mode baca-saja (build preview ke API produksi): semua perintah uang dinonaktifkan di UI dan ditolak di jalur perintah klien.
// Ini bukan keamanan (backend tetap penentu) — hanya pengaman salah-ketuk saat uji di data produksi.

/* eslint-disable import/first */
jest.mock("@/lib/env", () => ({ ENV: { useMocks: true, readOnly: true, apiUrl: "http://x/api", appEnv: "preview", variant: "preview", version: "0.2.0" } }));

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/design/theme";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { jalankanPerintah } from "@/api/command";
import { setSkenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import * as mockTx from "@/mocks/transaksi";
import { PESAN_BACA_SAJA } from "@/lib/bacaSaja";
import DetailRute from "../../app/tx/[modul]/[id]";
import BaruRute from "../../app/tx/[modul]/baru";
import { FotoProfil } from "@/features/profil/FotoProfil";

const router = jest.requireMock("expo-router") as { __setParams: (p: object) => void };
const T = { timeout: 5000 };
jest.setTimeout(20000);

function tampil(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}><ThemeProvider>{children}</ThemeProvider></QueryClientProvider> });
}
function masuk(email: string) {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
}

beforeEach(() => {
  setSkenario("normal");
  useLock.setState({ pinSet: true, lastUnlockAt: Date.now() });
});
afterEach(() => jest.restoreAllMocks());

describe("Mode baca-saja", () => {
  it("jalur perintah menolak SEBELUM step-up dan sebelum apa pun dikirim", async () => {
    masuk("owner@x");
    const run = jest.fn();
    await expect(jalankanPerintah({ need: "financePost", stepUp: true, run })).rejects.toMatchObject({ name: "ModeBacaSaja", message: PESAN_BACA_SAJA });
    expect(run).not.toHaveBeenCalled();
  });

  it("detail: banner tampil, semua tombol perintah nonaktif dengan penjelasan, tidak ada yang terkirim", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    masuk("owner@x"); // admin: semua aksi boleh menurut server
    router.__setParams({ modul: "pengeluaran", id: "e5" });
    tampil(<DetailRute />);
    await waitFor(() => expect(screen.getByLabelText("Ajukan untuk persetujuan")).toBeTruthy(), T);
    expect(screen.getAllByLabelText(PESAN_BACA_SAJA).length).toBeGreaterThan(0);
    expect(screen.getAllByText(PESAN_BACA_SAJA).length).toBeGreaterThan(1); // banner + catatan di area tombol
    for (const label of ["Ajukan untuk persetujuan", "Ubah", "Lampirkan nota"]) {
      const tombol = screen.queryByLabelText(label);
      if (tombol) expect(tombol.props.accessibilityState.disabled).toBe(true);
    }
    fireEvent.press(screen.getByLabelText("Ajukan untuk persetujuan"));
    expect(kirim).not.toHaveBeenCalled();
  });

  it("formulir: tombol kirim nonaktif; draf di HP tetap bisa disimpan (tidak memposting apa pun)", async () => {
    const kirim = jest.spyOn(mockTx, "mockKirimTx");
    masuk("finance@x");
    router.__setParams({ modul: "pengeluaran" });
    tampil(<BaruRute />);
    await waitFor(() => expect(screen.getByLabelText("Ajukan")).toBeTruthy(), T);
    expect(screen.getByLabelText("Ajukan").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Simpan sebagai draf di server").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Simpan draf di HP").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText("Ajukan"));
    expect(kirim).not.toHaveBeenCalled();
  });

  it("foto profil: tidak bisa diganti dari build preview (penjelasan tampil, tidak ada sheet)", async () => {
    masuk("finance@x");
    tampil(<FotoProfil />);
    expect(screen.getByText(PESAN_BACA_SAJA)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    expect(screen.queryByLabelText("Pilih dari galeri")).toBeNull();
  });
});
