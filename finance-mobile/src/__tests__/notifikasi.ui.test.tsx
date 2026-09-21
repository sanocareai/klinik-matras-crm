// Layar Notifikasi (S11): kategori mengikuti capability, izin TIDAK diminta otomatis, saklar menyimpan preferensi.

/* eslint-disable import/first */
jest.mock("@/lib/env", () => ({ ENV: { appEnv: "development", useMocks: true, pushEnabled: true, readOnly: false, version: "1.0.0", apiUrl: "http://x/api", variant: "development" } }));
jest.mock("expo-device", () => ({ isDevice: true }));
const mockMinta = jest.fn();
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ status: "undetermined" }), requestPermissionsAsync: (...a: unknown[]) => mockMinta(...a), getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(), setNotificationHandler: jest.fn(), AndroidImportance: {}, AndroidNotificationVisibility: {},
}));

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/design/theme";
import { useSession } from "@/auth/session";
import { setSkenario } from "@/mocks/skenario";
import { peranContoh } from "@/mocks/roles";
import Notifikasi from "../../app/notifikasi";

jest.setTimeout(20000);
function tampil(email: string) {
  setSkenario("normal");
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: p.user, capabilities: p.capabilities });
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}><ThemeProvider><Notifikasi /></ThemeProvider></QueryClientProvider>);
}

describe("layar Notifikasi", () => {
  it("penyetuju: tidak melihat Pembayaran dan Transaksi sensitif", async () => {
    tampil("approver@x");
    await waitFor(() => expect(screen.getByLabelText("Notifikasi Persetujuan")).toBeTruthy());
    expect(screen.queryByLabelText("Notifikasi Pembayaran")).toBeNull();
    expect(screen.queryByLabelText("Notifikasi Transaksi sensitif")).toBeNull();
    expect(screen.getByLabelText("Notifikasi Piutang jatuh tempo")).toBeTruthy();
  });

  it("owner melihat transaksi sensitif; izin belum ada ⇒ tombol aktifkan dan TIDAK ada dialog izin otomatis", async () => {
    tampil("owner@x");
    await waitFor(() => expect(screen.getByLabelText("Notifikasi Transaksi sensitif")).toBeTruthy());
    expect(screen.getByLabelText("Aktifkan notifikasi")).toBeTruthy();
    expect(mockMinta).not.toHaveBeenCalled();
  });

  it("izin diminta HANYA saat pengguna menekan Aktifkan", async () => {
    mockMinta.mockResolvedValue({ status: "denied" });
    tampil("finance@x");
    await waitFor(() => expect(screen.getByLabelText("Aktifkan notifikasi")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Aktifkan notifikasi"));
    await waitFor(() => expect(mockMinta).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Izin notifikasi ditolak/)).toBeTruthy());
  });

  it("mengubah saklar menyimpan preferensi kategori itu", async () => {
    tampil("finance@x");
    await waitFor(() => expect(screen.getByLabelText("Notifikasi Persetujuan")).toBeTruthy());
    fireEvent(screen.getByLabelText("Notifikasi Persetujuan"), "valueChange", false);
    await waitFor(() => expect(screen.getByLabelText("Notifikasi Persetujuan").props.value).toBe(false));
    expect(screen.getByLabelText("Notifikasi Pembayaran").props.value).toBe(true);
  });
});
