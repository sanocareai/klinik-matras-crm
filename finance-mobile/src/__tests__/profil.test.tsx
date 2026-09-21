// Foto profil: alamat aman, fallback inisial, alur ganti foto (kamera/galeri), offline, double-tap, gagal unggah. Server contoh (tanpa jaringan).

/* eslint-disable import/first */
jest.mock("@/lib/env", () => ({ ENV: { appEnv: "production", useMocks: true, pushEnabled: false, readOnly: false, version: "1.0.0", apiUrl: "https://app.sanomatrassehat.com/api", variant: "production" } }));

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import * as NetInfo from "@react-native-community/netinfo";
import { ThemeProvider } from "@/design/theme";
import { Avatar } from "@/design/Avatar";
import { useSession } from "@/auth/session";
import { peranContoh } from "@/mocks/roles";
import { alamatAvatar, inisial } from "@/lib/avatar";
import * as profil from "@/api/profil";
import { FotoProfil } from "@/features/profil/FotoProfil";

const netinfo = NetInfo as unknown as { useNetInfo: jest.Mock };
jest.setTimeout(20000);

const tampil = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
function masuk(avatarUrl: string | null = null) {
  const p = peranContoh("finance@x");
  if ("tanpaAkses" in p) throw new Error("x");
  useSession.setState({ status: "signedIn", user: { ...p.user, avatarUrl }, capabilities: p.capabilities });
}

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.useNetInfo.mockReturnValue({ isConnected: true, isInternetReachable: true });
});

describe("alamat avatar", () => {
  it("path server → alamat absolut di origin API (tanpa /api)", () => {
    expect(alamatAvatar("/uploads/avatars/u1-123.png")).toBe("https://app.sanomatrassehat.com/uploads/avatars/u1-123.png");
  });
  it.each([null, undefined, "", "/uploads/avatars/../../etc/passwd", "/lain/x.png", "javascript:alert(1)", "http://evil.example/x.png", "file:///sdcard/x.jpg", "//evil.example/x.png"])("%s → ditolak", (v) => {
    expect(alamatAvatar(v as string | null)).toBeNull();
  });
  it("https penuh diterima; inisial", () => {
    expect(alamatAvatar("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(inisial("natasha")).toBe("N");
    expect(inisial("")).toBe("?");
    expect(inisial(null)).toBe("?");
  });
});

describe("Avatar", () => {
  it("tanpa foto → inisial", () => {
    tampil(<Avatar nama="Natasha" avatarUrl={null} />);
    expect(screen.getByLabelText("Inisial Natasha")).toBeTruthy();
    expect(screen.getByText("N")).toBeTruthy();
  });
  it("dengan foto → memakai foto (bukan inisial)", () => {
    tampil(<Avatar nama="Natasha" avatarUrl="/uploads/avatars/a.png" />);
    expect(screen.getByLabelText("Foto profil Natasha")).toBeTruthy();
    expect(screen.queryByText("N")).toBeNull();
  });
});

describe("FotoProfil (ganti foto)", () => {
  it("galeri → unggah → foto baru tampil di sesi", async () => {
    masuk();
    const unggah = jest.spyOn(profil, "gantiFotoProfil");
    tampil(<FotoProfil />);
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    await waitFor(() => expect(screen.getByLabelText("Pilih dari galeri")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Pilih dari galeri"));
    await waitFor(() => expect(screen.getByText(/Foto profil diperbarui/)).toBeTruthy());
    expect(unggah).toHaveBeenCalledWith({ uri: "file:///galeri.jpg", nama: "galeri.jpg", mime: undefined });
    expect(useSession.getState().user?.avatarUrl).toBe("file:///galeri.jpg");
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }));
  });

  it("kamera dengan izin ditolak → tidak ada unggahan", async () => {
    masuk();
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
    const unggah = jest.spyOn(profil, "gantiFotoProfil");
    tampil(<FotoProfil />);
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    await waitFor(() => expect(screen.getByLabelText("Ambil foto")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Ambil foto"));
    await waitFor(() => expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled());
    expect(unggah).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it("batal memilih → tidak ada unggahan dan foto tidak berubah", async () => {
    masuk("/uploads/avatars/lama.png");
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: [] });
    const unggah = jest.spyOn(profil, "gantiFotoProfil");
    tampil(<FotoProfil />);
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    await waitFor(() => expect(screen.getByLabelText("Pilih dari galeri")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Pilih dari galeri"));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(unggah).not.toHaveBeenCalled();
    expect(useSession.getState().user?.avatarUrl).toBe("/uploads/avatars/lama.png");
  });

  it("gagal unggah → pesan, foto lama tetap", async () => {
    masuk("/uploads/avatars/lama.png");
    jest.spyOn(profil, "gantiFotoProfil").mockRejectedValueOnce(new Error("boom"));
    tampil(<FotoProfil />);
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    await waitFor(() => expect(screen.getByLabelText("Pilih dari galeri")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Pilih dari galeri"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(useSession.getState().user?.avatarUrl).toBe("/uploads/avatars/lama.png");
  });

  it("double-tap pilihan: hanya SATU unggahan", async () => {
    masuk();
    let lepas: (v: string) => void = () => undefined;
    const unggah = jest.spyOn(profil, "gantiFotoProfil").mockImplementation(() => new Promise<string>((r) => { lepas = r; }));
    tampil(<FotoProfil />);
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    await waitFor(() => expect(screen.getByLabelText("Pilih dari galeri")).toBeTruthy());
    const t = screen.getByLabelText("Pilih dari galeri");
    fireEvent.press(t); fireEvent.press(t);
    await waitFor(() => expect(unggah).toHaveBeenCalledTimes(1));
    lepas("/uploads/avatars/baru.png");
    await waitFor(() => expect(useSession.getState().user?.avatarUrl).toBe("/uploads/avatars/baru.png"));
    expect(unggah).toHaveBeenCalledTimes(1);
  });

  it("offline → tidak bisa mengganti (dengan penjelasan)", async () => {
    masuk();
    netinfo.useNetInfo.mockReturnValue({ isConnected: false, isInternetReachable: false });
    tampil(<FotoProfil />);
    expect(screen.getByText(/Tidak ada koneksi/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Ganti foto profil"));
    expect(screen.queryByLabelText("Pilih dari galeri")).toBeNull();
  });
});
