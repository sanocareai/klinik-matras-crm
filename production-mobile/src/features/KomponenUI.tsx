import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { Camera, Images, Play, Search, Video, X } from "lucide-react-native";
import { cariBahanKomponen, unggahMediaKomponen } from "@/api/komponen";
import { pesanUntukPengguna } from "@/api/errors";
import { LABEL_MANUAL, LABEL_TIDAK_TAHU, rapikanBahan, teksBahan, type MediaKomponen, type RefBahan } from "./komponen";
import { PilihanChip } from "@/design/Form";
import { T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { urlMedia } from "@/lib/env";

// KOMPONEN UI CATATAN KOMPONEN — cermin MaterialPicker & unggahan panel web.

const MODE = [{ value: "CATALOG", label: "Katalog" }, { value: "MANUAL", label: LABEL_MANUAL }, { value: "UNKNOWN", label: LABEL_TIDAK_TAHU }] as const;

/** Bahan: Katalog (tautan, TIDAK memotong stok), "Bahan manual" (teks), atau "Tidak diketahui" (tidak ditebak). */
export function PemilihBahan({ label = "Bahan", value, onChange, opsional }: { label?: string; value: RefBahan | null; onChange: (v: RefBahan | null) => void; opsional?: boolean }) {
  const mode = value?.kind ?? null;
  const [q, setQ] = useState("");
  const hasil = useQuery({ queryKey: ["bahan-komponen", q.trim()], queryFn: () => cariBahanKomponen(q.trim()), enabled: mode === "CATALOG", staleTime: 60_000 });
  const pilihMode = (m: string | undefined) => {
    if (!m || m === mode) return;
    onChange(m === "UNKNOWN" ? { kind: "UNKNOWN" } : m === "MANUAL" ? { kind: "MANUAL", text: "" } : { kind: "CATALOG", materialId: null });
  };
  return (
    <View style={{ gap: 8 }}>
      <PilihanChip label={`${label}${opsional ? " (opsional)" : ""}`} options={MODE} value={mode ? [mode] : []} onChange={(v) => pilihMode(v[0])} />
      {opsional && mode ? <Pressable onPress={() => onChange(null)} style={{ alignSelf: "flex-start", paddingHorizontal: 4, minHeight: 32, justifyContent: "center" }}><T.Caption style={{ color: TONE.blue.text }}>Kosongkan bahan</T.Caption></Pressable> : null}
      {value?.kind === "MANUAL" ? (
        <TextInput accessibilityLabel={`${label}: ${LABEL_MANUAL}`} value={value.text} onChangeText={(text) => onChange({ kind: "MANUAL", text })} maxLength={120} placeholder="Nama bahan" placeholderTextColor={C.ink3}
          style={{ backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, minHeight: 50, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
      ) : null}
      {value?.kind === "UNKNOWN" ? <T.Caption style={{ marginHorizontal: 4 }}>Dicatat “{LABEL_TIDAK_TAHU}” — tidak ditebak.</T.Caption> : null}
      {value?.kind === "CATALOG" ? (
        <View style={{ gap: 6 }}>
          {value.materialId ? <T.Sub style={{ color: TONE.blue.text, marginHorizontal: 4 }}>Dipilih: {teksBahan(value)}</T.Sub> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 12, paddingHorizontal: 12, height: 44 }}>
            <Search color={C.ink3} size={17} />
            <TextInput accessibilityLabel="Cari bahan katalog" value={q} onChangeText={setQ} placeholder="Cari kode/nama bahan" placeholderTextColor={C.ink3} style={{ flex: 1, fontFamily: F.regular, fontSize: 15, color: C.ink }} />
          </View>
          {hasil.error ? <T.Caption style={{ color: TONE.orange.text }}>Katalog tidak dapat dimuat — pakai “{LABEL_MANUAL}”.</T.Caption> : null}
          {(hasil.data?.items ?? []).slice(0, 8).map((m) => (
            <Pressable key={m.materialId} accessibilityRole="button" onPress={() => onChange(rapikanBahan(m))}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: value.materialId === m.materialId ? TONE.blue.tint : C.card, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 }}>
              <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 14.5, color: C.ink }} numberOfLines={1}>{m.name}</Text>
              <T.Caption>{m.code}</T.Caption>
            </Pressable>
          ))}
          {hasil.data && !hasil.data.items.length ? <T.Caption>Tidak ada yang cocok — pakai “{LABEL_MANUAL}”.</T.Caption> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Lampiran Catatan Komponen: kamera foto/video atau galeri; langsung diunggah ke store bukti unit. */
export function LampiranKomponen({ unitId, items, onChange, min, maks, disabled, onSibuk }: {
  unitId: string; items: MediaKomponen[]; onChange: (v: MediaKomponen[]) => void; min: number; maks: number; disabled?: boolean; onSibuk?: (sibuk: boolean) => void;
}) {
  const [unggah, setUnggah] = useState(0);
  useEffect(() => { onSibuk?.(unggah > 0); }, [unggah, onSibuk]);
  const [galat, setGalat] = useState<string | null>(null);
  const kirim = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const sisa = Math.max(0, maks - items.length);
    const pilih = assets.slice(0, sisa);
    if (assets.length > sisa) setGalat(`Maksimal ${maks} foto/video.`);
    setUnggah((n) => n + pilih.length);
    const hasil: MediaKomponen[] = [];
    for (const a of pilih) {
      try { hasil.push(await unggahMediaKomponen(unitId, { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, type: a.type ?? null })); }
      catch (e) { setGalat(pesanUntukPengguna(e)); }
      finally { setUnggah((n) => n - 1); }
    }
    if (hasil.length) onChange([...items, ...hasil]);
  };
  const ambil = async (sumber: "foto" | "video" | "galeri") => {
    setGalat(null);
    try {
      if (sumber === "galeri") {
        const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!izin.granted) { Alert.alert("Izin galeri ditolak", "Buka Pengaturan HP untuk mengizinkan akses galeri."); return; }
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: 6, quality: 0.7 });
        if (!r.canceled) await kirim(r.assets);
        return;
      }
      const izin = await ImagePicker.requestCameraPermissionsAsync();
      if (!izin.granted) { Alert.alert("Izin kamera ditolak", "Buka Pengaturan HP untuk mengizinkan kamera."); return; }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: sumber === "video" ? ["videos"] : ["images"], quality: 0.7, videoMaxDuration: 120 });
      if (!r.canceled) await kirim(r.assets);
    } catch { setGalat("Kamera/galeri tidak bisa dibuka."); }
  };
  const tombol = (Ikon: typeof Camera, label: string, s: "foto" | "video" | "galeri") => (
    <Pressable key={s} accessibilityRole="button" disabled={disabled || items.length >= maks} onPress={() => void ambil(s)}
      style={{ flex: 1, height: 56, borderRadius: 14, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center", gap: 2, opacity: disabled || items.length >= maks ? 0.4 : 1 }}>
      <Ikon color={TONE.blue.text} size={20} /><Text style={{ fontFamily: F.semibold, fontSize: 12.5, color: TONE.blue.text }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <T.Sub style={{ marginHorizontal: 4 }}>Foto/video{min ? ` (wajib minimal ${min})` : " (opsional)"} · {items.length}/{maks}</T.Sub>
      <View style={{ flexDirection: "row", gap: 8 }}>{tombol(Camera, "Foto", "foto")}{tombol(Video, "Video", "video")}{tombol(Images, "Galeri", "galeri")}</View>
      {items.length || unggah ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map((m) => (
            <View key={m.url}>
              {m.kind === "video" ? (
                <View style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" }}><Play color="#fff" size={26} fill="#fff" /></View>
              ) : <Image source={{ uri: urlMedia(m.previewUrl) ?? undefined }} style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: C.fill }} contentFit="cover" />}
              <Pressable accessibilityRole="button" accessibilityLabel="Hapus lampiran" onPress={() => onChange(items.filter((x) => x.url !== m.url))}
                style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                <X color="#fff" size={15} />
              </Pressable>
            </View>
          ))}
          {Array.from({ length: unggah }, (_, i) => (
            <View key={`u${i}`} style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>
          ))}
        </View>
      ) : null}
      {galat ? <T.Caption style={{ color: TONE.red.text }}>{galat}</T.Caption> : null}
    </View>
  );
}

