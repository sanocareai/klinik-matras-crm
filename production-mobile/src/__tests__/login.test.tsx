import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { ApiError } from "@/api/errors";
import { useKeamanan } from "@/auth/keamanan";
import Login from "../../app/login";

// Layar login ujung-ke-ujung (tanpa server): sesi ditiru; store keamanan & SecureStore asli (mock memori dari jest.setup).
const mockLogin = jest.fn();
jest.mock("@/auth/session", () => {
  const state = { login: (...a: unknown[]) => mockLogin(...a), sesiHilang: null };
  const useSession = (sel: (s: typeof state) => unknown) => sel(state);
  return { useSession };
});
jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context/jest/mock").default);
jest.mock("@/design/AppIcon", () => ({ AppIcon: () => null }));

// Render pertama (cache jest dingin) bisa >5 dtk di laptop ini — batas bawaan jest terlalu mepet.
jest.setTimeout(20_000);

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const la = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const KEY_KRED = "produksi.login-cepat.v1";

beforeEach(async () => {
  store.clear();
  mockLogin.mockReset();
  mockLogin.mockResolvedValue(undefined);
  la.getEnrolledLevelAsync.mockResolvedValue(3 as never);
  la.supportedAuthenticationTypesAsync.mockResolvedValue([1] as never);
  la.authenticateAsync.mockReset();
  la.authenticateAsync.mockResolvedValue({ success: true } as never);
  await useKeamanan.getState().reset();
  await useKeamanan.getState().muat();
});

test("login pertama: email & kata sandi → masuk, lalu disimpan untuk masuk cepat setelah sidik jari", async () => {
  render(<Login />);
  fireEvent.changeText(screen.getByLabelText("Email"), "imam@klinikmatras.com");
  fireEvent.changeText(screen.getByLabelText("Kata sandi"), "kasursehat1");
  expect(screen.getByText("Simpan untuk masuk cepat dengan sidik jari")).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText("Masuk")); });
  expect(mockLogin).toHaveBeenCalledWith("imam@klinikmatras.com", "kasursehat1");
  await waitFor(() => expect(useKeamanan.getState().loginCepatEmail).toBe("imam@klinikmatras.com"));
  expect(JSON.parse(store.get(KEY_KRED)!).password).toBe("kasursehat1");
  // Urutan: kata sandi dibuktikan ke server DULU, baru disimpan.
  expect(mockLogin.mock.invocationCallOrder[0]).toBeLessThan(la.authenticateAsync.mock.invocationCallOrder[0]!);
});

test("kata sandi salah → TIDAK disimpan dan tidak ada dialog sidik jari", async () => {
  mockLogin.mockRejectedValue(new ApiError({ status: 401, message: "Email atau password salah" }));
  render(<Login />);
  fireEvent.changeText(screen.getByLabelText("Email"), "imam@klinikmatras.com");
  fireEvent.changeText(screen.getByLabelText("Kata sandi"), "salah");
  await act(async () => { fireEvent.press(screen.getByText("Masuk")); });
  expect(await screen.findByText("Email atau password salah")).toBeTruthy();
  expect(la.authenticateAsync).not.toHaveBeenCalled();
  expect(store.has(KEY_KRED)).toBe(false);
});

test("tanpa centang simpan → tidak disimpan", async () => {
  render(<Login />);
  fireEvent.changeText(screen.getByLabelText("Email"), "imam@klinikmatras.com");
  fireEvent.changeText(screen.getByLabelText("Kata sandi"), "kasursehat1");
  fireEvent.press(screen.getByText("Simpan untuk masuk cepat dengan sidik jari"));
  await act(async () => { fireEvent.press(screen.getByText("Masuk")); });
  expect(mockLogin).toHaveBeenCalled();
  expect(la.authenticateAsync).not.toHaveBeenCalled();
  expect(store.has(KEY_KRED)).toBe(false);
});

test("masuk cepat: dialog sidik jari muncul otomatis lalu masuk tanpa mengetik", async () => {
  await useKeamanan.getState().simpanLoginCepat("imam@klinikmatras.com", "kasursehat1");
  la.authenticateAsync.mockClear();
  render(<Login />);
  await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("imam@klinikmatras.com", "kasursehat1"));
  expect(la.authenticateAsync).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Masuk dengan sidik jari")).toBeTruthy();
});

test("masuk cepat dibatalkan → tetap di layar login tanpa pesan galat, bisa ketik kata sandi", async () => {
  await useKeamanan.getState().simpanLoginCepat("imam@klinikmatras.com", "kasursehat1");
  la.authenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" } as never);
  render(<Login />);
  await waitFor(() => expect(la.authenticateAsync).toHaveBeenCalledTimes(2));
  expect(mockLogin).not.toHaveBeenCalled();
  expect(screen.queryByText(/Tidak dikenali/)).toBeNull();
  expect(screen.getByLabelText("Kata sandi")).toBeTruthy();
});

test("kata sandi tersimpan sudah diganti (server 401) → dihapus, email tetap terisi, diminta ketik kata sandi baru", async () => {
  await useKeamanan.getState().simpanLoginCepat("imam@klinikmatras.com", "lama");
  mockLogin.mockRejectedValue(new ApiError({ status: 401, message: "Email atau password salah" }));
  render(<Login />);
  expect(await screen.findByText(/Kata sandi tersimpan sudah tidak berlaku/)).toBeTruthy();
  expect(store.has(KEY_KRED)).toBe(false);
  expect(useKeamanan.getState().loginCepatEmail).toBeNull();
  expect(screen.getByLabelText("Email").props.value).toBe("imam@klinikmatras.com");
});

test("HP tanpa kunci layar → tidak ada pilihan masuk cepat", async () => {
  la.getEnrolledLevelAsync.mockResolvedValue(0 as never);
  await useKeamanan.getState().muat();
  render(<Login />);
  expect(screen.queryByText(/Simpan untuk masuk cepat/)).toBeNull();
});

test("email terakhir terisi otomatis", async () => {
  await useKeamanan.getState().ingatEmail("ferdy@klinikmatras.com");
  render(<Login />);
  expect(screen.getByLabelText("Email").props.value).toBe("ferdy@klinikmatras.com");
});
