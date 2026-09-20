// Mock modul native yang tidak tersedia di lingkungan Jest.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
    __store: store,
  };
});
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
jest.mock("expo-crypto", () => ({
  // UUID unik per panggilan (kunci idempotensi harus berbeda antar niat).
  randomUUID: jest.fn(() => {
    globalThis.__uuidN = (globalThis.__uuidN || 0) + 1;
    return `00000000-0000-4000-8000-${String(globalThis.__uuidN).padStart(12, "0")}`;
  }),
  getRandomBytes: jest.fn((n) => new Uint8Array(n).map((_, i) => (i * 37 + 11) % 256)),
}));
// Biometrik: perangkat dengan sensor & sidik jari terdaftar; tes mengubah perilaku per kasus.
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
// Jaringan: online secara default; tes mengubah nilai balik useNetInfo untuk skenario offline.
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
  addEventListener: jest.fn(() => jest.fn()),
  useNetInfo: jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
}));
// Router: hanya push/back yang dipakai layar.
jest.mock("expo-router", () => {
  const push = jest.fn();
  const back = jest.fn();
  let params = {};
  return {
    useRouter: () => ({ push, back, replace: jest.fn() }), __push: push, __back: back, __setParams: (p) => { params = p; },
    Stack: () => null, Redirect: () => null, useLocalSearchParams: () => params,
  };
});
// Ikon: komponen kosong per nama (paket ESM tidak diproses Jest).
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_t, nama) => (nama === "__esModule" ? true : () => null) }));
