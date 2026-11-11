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
jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => {
    globalThis.__uuidN = (globalThis.__uuidN || 0) + 1;
    return `00000000-0000-4000-8000-${String(globalThis.__uuidN).padStart(12, "0")}`;
  }),
}));
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_t, nama) => (nama === "__esModule" ? true : () => null) }));
