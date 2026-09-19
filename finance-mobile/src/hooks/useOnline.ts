import { useNetInfo } from "@react-native-community/netinfo";

/** true bila perangkat punya koneksi internet (null = belum diketahui → dianggap online). */
export function useOnline(): boolean {
  const { isConnected, isInternetReachable } = useNetInfo();
  if (isConnected === false) return false;
  if (isInternetReachable === false) return false;
  return true;
}
