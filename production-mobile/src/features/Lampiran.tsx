import React from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Camera, Images, Play, RotateCw, Video, X } from "lucide-react-native";
import { unggahBukti, type BerkasLokal } from "@/api/aksi";
import { pesanUntukPengguna } from "@/api/errors";
import type { MediaTerunggah } from "./langkah";
import { C, F, TONE } from "@/design/tokens";

// LAMPIRAN BUKTI — Foto (kamera), Video (kamera), atau Galeri (foto/video). Setiap berkas langsung diunggah
// ke server; hanya yang SELESAI terunggah ikut dikirim bersama tahap. Gagal → bisa diulang atau dihapus.

export type ItemLampiran = { id: string; lokal: BerkasLokal; status: "unggah" | "selesai" | "gagal"; hasil?: MediaTerunggah; galat?: string };

let urut = 0;
const idBaru = () => `l${Date.now().toString(36)}${(urut++).toString(36)}`;

export function useLampiran(runId: string) {
  const [items, setItems] = React.useState<ItemLampiran[]>([]);
  const ubah = (id: string, p: Partial<ItemLampiran>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const kirim = React.useCallback(async (id: string, lokal: BerkasLokal) => {
    ubah(id, { status: "unggah", galat: undefined });
    try {
      const hasil = await unggahBukti(runId, lokal);
      ubah(id, { status: "selesai", hasil });
    } catch (e) {
      ubah(id, { status: "gagal", galat: pesanUntukPengguna(e) });
    }
  }, [runId]);

  const tambah = (assets: ImagePicker.ImagePickerAsset[]) => {
    const baru = assets.map((a) => ({ id: idBaru(), lokal: { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, type: a.type ?? null }, status: "unggah" as const }));
    setItems((xs) => [...xs, ...baru]);
    for (const b of baru) void kirim(b.id, b.lokal);
  };

  const ambil = async (sumber: "foto" | "video" | "galeri") => {
    try {
      if (sumber === "galeri") {
        const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!izin.granted) { Alert.alert("Izin galeri ditolak", "Buka Pengaturan HP untuk mengizinkan akses galeri."); return; }
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: 6, quality: 0.7 });
        if (!r.canceled) tambah(r.assets);
        return;
      }
      const izin = await ImagePicker.requestCameraPermissionsAsync();
      if (!izin.granted) { Alert.alert("Izin kamera ditolak", "Buka Pengaturan HP untuk mengizinkan kamera."); return; }
      const r = await ImagePicker.launchCameraAsync(
        sumber === "video" ? { mediaTypes: ["videos"], videoMaxDuration: 120, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium } : { mediaTypes: ["images"], quality: 0.7 },
      );
      if (!r.canceled) tambah(r.assets);
    } catch {
      Alert.alert("Kamera tidak bisa dibuka", "Coba lagi, atau pilih dari galeri.");
    }
  };

  return {
    items,
    selesai: items.filter((i) => i.status === "selesai" && i.hasil).map((i) => i.hasil!),
    sibuk: items.some((i) => i.status === "unggah"),
    adaGagal: items.some((i) => i.status === "gagal"),
    ambil,
    ulang: (id: string) => { const it = items.find((x) => x.id === id); if (it) void kirim(id, it.lokal); },
    hapus: (id: string) => setItems((xs) => xs.filter((x) => x.id !== id)),
  };
}

export function PanelLampiran({ l, aturan, disabled }: { l: ReturnType<typeof useLampiran>; aturan: { min: number; video: boolean }; disabled?: boolean }) {
  const adaVideo = l.selesai.some((m) => m.kind === "video");
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 4 }}>
        <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.ink2 }}>
          FOTO / VIDEO {aturan.min ? `· wajib ${aturan.min}${aturan.video ? " (termasuk video)" : ""}` : "· opsional"}
        </Text>
        <Text style={{ fontFamily: F.semibold, fontSize: 13, color: aturan.video && !adaVideo ? TONE.orange.text : C.ink3 }}>
          {l.selesai.length} terunggah{aturan.video ? (adaVideo ? " · video ✓" : " · belum ada video") : ""}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TombolAmbil label="Foto" ikon={<Camera color={TONE.purple.text} size={22} />} onPress={() => void l.ambil("foto")} disabled={disabled} />
        <TombolAmbil label="Video" ikon={<Video color={TONE.purple.text} size={22} />} onPress={() => void l.ambil("video")} disabled={disabled} sorot={aturan.video && !adaVideo} />
        <TombolAmbil label="Galeri" ikon={<Images color={TONE.purple.text} size={22} />} onPress={() => void l.ambil("galeri")} disabled={disabled} />
      </View>
      {l.items.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {l.items.map((it) => (
            <View key={it.id} style={{ width: 92, height: 92, borderRadius: 14, overflow: "hidden", backgroundColor: "#2C2C2E" }}>
              {it.lokal.type === "video" ? (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Play color="#fff" size={26} fill="#fff" /></View>
              ) : (
                <Image source={{ uri: it.lokal.uri }} style={{ flex: 1 }} contentFit="cover" />
              )}
              {it.status !== "selesai" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={it.status === "gagal" ? `Ulangi unggah. ${it.galat ?? ""}` : "Sedang mengunggah"}
                  disabled={it.status !== "gagal"}
                  onPress={() => l.ulang(it.id)}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: it.status === "gagal" ? "rgba(196,0,15,0.75)" : "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", gap: 4 }}
                >
                  {it.status === "unggah" ? <ActivityIndicator color="#fff" /> : <><RotateCw color="#fff" size={20} /><Text style={{ color: "#fff", fontFamily: F.bold, fontSize: 11 }}>Ulangi</Text></>}
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Hapus lampiran" onPress={() => l.hapus(it.id)} hitSlop={8} style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                <X color="#fff" size={15} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {l.adaGagal ? <Text style={{ fontFamily: F.medium, fontSize: 13, color: TONE.red.text, marginHorizontal: 4 }}>Ada unggahan gagal — ketuk untuk mengulang, atau hapus.</Text> : null}
    </View>
  );
}

function TombolAmbil({ label, ikon, onPress, disabled, sorot }: { label: string; ikon: React.ReactNode; onPress: () => void; disabled?: boolean; sorot?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ambil ${label.toLowerCase()}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, height: 72, borderRadius: 16, backgroundColor: TONE.purple.tint, alignItems: "center", justifyContent: "center", gap: 4, borderWidth: sorot ? 2 : 0, borderColor: TONE.purple.fill, borderStyle: "dashed" }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
    >
      {ikon}
      <Text style={{ fontFamily: F.bold, fontSize: 14, color: TONE.purple.text }}>{label}</Text>
    </Pressable>
  );
}
