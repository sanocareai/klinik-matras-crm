// Storage key-value persisten untuk store (draft, outbox, dsb).
// react-native-mmkv adalah native module — TIDAK bisa jalan di Expo Go
// (sama seperti expo-notifications, lihat catatan isExpoGo di src/push.js).
// Fallback in-memory dipakai saat Expo Go supaya "npx expo start" tetap
// bisa ditest tanpa crash; persist beneran baru aktif di APK hasil EAS build.
import Constants, { ExecutionEnvironment } from "expo-constants";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let storage;
if (isExpoGo) {
  const mem = new Map();
  storage = {
    getString: (key) => mem.get(key),
    set: (key, value) => mem.set(key, value),
    delete: (key) => mem.delete(key),
  };
} else {
  const { MMKV } = require("react-native-mmkv");
  storage = new MMKV({ id: "klinik-matras-mobile" });
}

export default storage;

// Adapter supaya bisa dipakai zustand persist middleware (createJSONStorage
// butuh getItem/setItem/removeItem, bukan getString/set/delete-nya MMKV).
export const zustandMMKVStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.delete(name),
};
