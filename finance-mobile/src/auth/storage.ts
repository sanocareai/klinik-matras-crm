import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import type { Tokens } from "@/api/client";
import type { Capabilities, SessionUser } from "@/api/types";

// PENYIMPANAN AMAN — hanya expo-secure-store (Android Keystore). Dilarang AsyncStorage/berkas
// biasa untuk rahasia (PRD §11.7). Refresh token = rahasia paling berharga.

const OPSI: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const KEY_SESI = "session.v1";
const KEY_DEVICE = "device.id";

export type SavedSession = {
  tokens: Tokens;
  user: SessionUser;
  capabilities: Capabilities;
};

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY_SESI, OPSI);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    return s?.tokens?.refreshToken && s?.user?.id ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: SavedSession): Promise<void> {
  await SecureStore.setItemAsync(KEY_SESI, JSON.stringify(s), OPSI);
}

/** Simpan hanya token baru (setelah rotasi refresh), user & capabilities tetap. */
export async function saveTokens(tokens: Tokens): Promise<void> {
  const ada = await loadSession();
  if (!ada) return;
  await saveSession({ ...ada, tokens });
}

export async function clearSession(): Promise<void> {
  try { await SecureStore.deleteItemAsync(KEY_SESI, OPSI); } catch { /* sudah kosong */ }
}

/** ID perangkat: UUID acak dibuat sekali saat pertama dipakai (bukan identitas perangkat keras). */
export async function getDeviceId(): Promise<string> {
  const ada = await SecureStore.getItemAsync(KEY_DEVICE, OPSI);
  if (ada) return ada;
  const baru = randomUUID();
  await SecureStore.setItemAsync(KEY_DEVICE, baru, OPSI);
  return baru;
}
