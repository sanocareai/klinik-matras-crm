import React, { useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { Play, X } from "lucide-react-native";
import type { GrupMedia } from "./model";
import { urlMedia } from "@/lib/env";
import { C, F } from "@/design/tokens";
import { T } from "@/design/ui";

type Item = GrupMedia["items"][number];

// GALERI foto & video (URL bertanda tangan dari server — tidak perlu token). Foto & video dibuka layar penuh
// di dalam aplikasi (video diputar expo-video dengan kontrol bawaan: putar/jeda, geser, layar penuh).
export function Galeri({ grup, kolom = 3 }: { grup: GrupMedia[]; kolom?: number }) {
  const { width } = useWindowDimensions();
  const [buka, setBuka] = useState<Item | null>(null);
  const sisi = (width - 32 - (kolom - 1) * 4) / kolom;

  const ketuk = (m: Item) => {
    const url = urlMedia(m.url);
    if (!url) return;
    setBuka(m);
  };

  return (
    <View style={{ gap: 16 }}>
      {grup.map((g) => (
        <View key={g.key}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 4, marginBottom: 8 }}>
            <T.Headline style={{ fontSize: 17 }}>{g.judul}</T.Headline>
            <T.Caption>{g.items.length} media</T.Caption>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {g.items.map((m, i) => (
              <Thumb key={`${g.key}-${i}`} m={m} sisi={sisi} onPress={() => ketuk(m)} />
            ))}
          </View>
        </View>
      ))}
      <Modal visible={!!buka} transparent animationType="fade" onRequestClose={() => setBuka(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {buka?.video ? <PemutarVideo url={urlMedia(buka.url)!} /> : buka ? <Image source={{ uri: urlMedia(buka.url)! }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={label(buka)} /> : null}
          <View style={{ position: "absolute", left: 16, right: 16, bottom: 40 }}>
            <Text style={{ color: "#fff", fontFamily: F.semibold, fontSize: 15 }}>{buka ? label(buka) : ""}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={() => setBuka(null)} style={{ position: "absolute", top: 48, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
            <X color="#fff" size={24} />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

/** Pemutar video di dalam aplikasi; berhenti & dilepas otomatis saat modal ditutup (komponen dilepas). */
function PemutarVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.play(); });
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls accessibilityLabel="Video dokumentasi" />;
}

const label = (m: Item) => m.stepLabel || m.label || m.caption || (m.video ? "Video" : "Foto");

export function Thumb({ m, sisi, onPress }: { m: Item; sisi: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${m.video ? "Video" : "Foto"} ${label(m)}`} onPress={onPress} style={{ width: sisi, height: sisi, borderRadius: 12, overflow: "hidden", backgroundColor: C.fill }}>
      {m.video ? (
        <View style={{ flex: 1, backgroundColor: "#2C2C2E", alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
            <Play color="#fff" size={20} fill="#fff" />
          </View>
        </View>
      ) : (
        <Image source={{ uri: urlMedia(m.url)! }} style={{ flex: 1 }} contentFit="cover" transition={120} />
      )}
      <View style={{ position: "absolute", left: 6, bottom: 6, right: 6 }}>
        <Text numberOfLines={1} style={{ alignSelf: "flex-start", fontFamily: F.bold, fontSize: 10.5, color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}>
          {label(m)}
        </Text>
      </View>
    </Pressable>
  );
}
