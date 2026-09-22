import * as Location from "expo-location";

// GPS best-effort: penolakan izin, sensor mati, atau timeout tidak pernah
// menggagalkan POD. Backend menerima null dan tetap memakai timestamp server.
export async function getProofLocation() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      lat: result.coords.latitude,
      lng: result.coords.longitude,
      accuracy: result.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}
