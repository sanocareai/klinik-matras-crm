import React, { useEffect, useMemo, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { HARI_PENDEK, NAMA_BULAN, dalamRentang, geserBulan, ketuk, labelRentang, pintasan, selBulan, type Rentang } from "@/features/rentangTanggal";
import { kunciTanggalWib, wib } from "@/lib/waktu";
import { PEGAS, useKurangiGerak } from "./gerak";
import { haptic } from "./haptics";
import { Button, PressableScale } from "./ui";
import { C, F, TONE } from "./tokens";

// LEMBAR KALENDER — pilih rentang tanggal (WIB) tanpa modul native: ketuk tanggal awal lalu tanggal akhir, atau pakai pintasan.
// Lembar bawah ala iOS (pegas naik, latar meredup) seperti Aksi Cepat. Tanggal setelah hari ini tidak bisa dipilih (order belum ada).
// Dipasang HANYA saat dibuka (pemanggil: `{buka ? <LembarKalender …/> : null}`), jadi isi awal selalu dari rentang yang sedang dipakai.
export function LembarKalender({ awal, onTutup, onPilih }: { awal: Rentang | null; onTutup: () => void; onPilih: (r: Rentang) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const kurangi = useKurangiGerak();
  const hariIni = kunciTanggalWib();
  const [pilih, setPilih] = useState<{ awal: string | null; akhir: string | null }>({ awal: awal?.dari ?? null, akhir: awal?.sampai ?? null });
  const mulai = awal ? { y: Number(awal.sampai.slice(0, 4)), m: Number(awal.sampai.slice(5, 7)) - 1 } : { y: wib().y, m: wib().m };
  const [bulan, setBulan] = useState(mulai);
  const [y] = useState(() => new Animated.Value(kurangi ? 0 : 700));
  const [redup] = useState(() => new Animated.Value(kurangi ? 1 : 0));

  // Masuk: lembar naik dengan pegas, latar meredup (native driver).
  useEffect(() => {
    if (kurangi) return;
    Animated.parallel([Animated.spring(y, { toValue: 0, ...PEGAS }), Animated.timing(redup, { toValue: 1, duration: 220, useNativeDriver: true })]).start();
  }, [y, redup, kurangi]);

  const tutup = (lalu?: () => void) => {
    const selesai = () => { onTutup(); lalu?.(); };
    if (kurangi) { selesai(); return; }
    Animated.parallel([
      Animated.timing(y, { toValue: 700, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(redup, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(selesai);
  };
  const terapkan = (r: Rentang) => { haptic.ringan(); tutup(() => onPilih(r)); };

  const sel = useMemo(() => selBulan(bulan.y, bulan.m), [bulan]);
  // Lebar sel = lebar kartu kalender (layar − tepi lembar 2×20 − isi kartu 2×10) ÷ 7, dibulatkan ke bawah supaya 7 kolom muat satu baris.
  const lebarSel = Math.floor((Math.min(width, 520) - 40 - 20) / 7);
  const bisaMaju = `${bulan.y}-${String(bulan.m + 1).padStart(2, "0")}` < hariIni.slice(0, 7);
  const siap = pilih.awal && pilih.akhir ? { dari: pilih.awal, sampai: pilih.akhir } : null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => tutup()}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,27,63,0.38)", opacity: redup }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup kalender" onPress={() => tutup()} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View style={{ backgroundColor: "#F7FAFE", borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom + 12, 26), gap: 14, boxShadow: "0 -10px 40px rgba(15,30,58,0.25)", transform: [{ translateY: y }] }}>
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#C5D3E6" }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ fontFamily: F.heavy, fontSize: 22, color: C.ink }}>Pilih tanggal</Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.medium, fontSize: 14, color: C.ink3 }}>
                {siap ? labelRentang(siap) : pilih.awal ? "Ketuk tanggal akhir" : "Ketuk tanggal awal, lalu tanggal akhir"}
              </Text>
            </View>
            <PressableScale accessibilityRole="button" accessibilityLabel="Tutup" onPress={() => tutup()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.white, alignItems: "center", justifyContent: "center" }}>
              <X size={22} color={C.ink} />
            </PressableScale>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {pintasan().map((p) => (
              <Pressable key={p.key} accessibilityRole="button" onPress={() => terapkan(p.r)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center", backgroundColor: "#D8E9FF" }}>
                <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 13, color: "#0056B3" }}>{p.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ borderRadius: 24, backgroundColor: C.white, padding: 10, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Bulan sebelumnya" hitSlop={8} onPress={() => { haptic.tick(); setBulan((b) => geserBulan(b.y, b.m, -1)); }}
                style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.isian }}>
                <ChevronLeft size={20} color={C.ink} />
              </Pressable>
              <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.heavy, fontSize: 16, color: C.ink }}>{NAMA_BULAN[bulan.m]} {bulan.y}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Bulan berikutnya" hitSlop={8} disabled={!bisaMaju} onPress={() => { haptic.tick(); setBulan((b) => geserBulan(b.y, b.m, 1)); }}
                style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.isian, opacity: bisaMaju ? 1 : 0.35 }}>
                <ChevronRight size={20} color={C.ink} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row" }}>
              {HARI_PENDEK.map((h) => <Text key={h} maxFontSizeMultiplier={1.1} style={{ width: lebarSel, textAlign: "center", fontFamily: F.bold, fontSize: 12, color: C.ink3 }}>{h}</Text>)}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {sel.map((k, i) => {
                if (!k) return <View key={`k${i}`} style={{ width: lebarSel, height: 42 }} />;
                const nanti = k > hariIni;
                const ujung = k === pilih.awal || k === pilih.akhir;
                const tengah = dalamRentang(k, pilih.awal, pilih.akhir) && !ujung;
                const awalPita = pilih.akhir && k === pilih.awal && pilih.awal !== pilih.akhir;
                const akhirPita = pilih.akhir && k === pilih.akhir && pilih.awal !== pilih.akhir;
                return (
                  <View key={k} style={{ width: lebarSel, height: 42, justifyContent: "center" }}>
                    {/* pita rentang di belakang lingkaran tanggal */}
                    {tengah || awalPita || akhirPita ? (
                      <View style={{ position: "absolute", top: 4, bottom: 4, left: awalPita ? lebarSel / 2 : 0, right: akhirPita ? lebarSel / 2 : 0, backgroundColor: TONE.blue.tint }} />
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={k} accessibilityState={{ selected: ujung, disabled: nanti }} disabled={nanti}
                      onPress={() => { haptic.tick(); setPilih((s) => ketuk(s, k)); }}
                      style={{ alignSelf: "center", width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: ujung ? TONE.blue.fill : "transparent", borderWidth: k === hariIni && !ujung ? 1.5 : 0, borderColor: TONE.blue.fill }}>
                      <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: ujung ? F.heavy : F.semibold, fontSize: 14, color: ujung ? C.white : nanti ? "#B8C4D6" : C.ink }}>{Number(k.slice(8))}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>

          <Button label={siap ? `Terapkan · ${labelRentang(siap)}` : "Pilih tanggal akhir"} disabled={!siap} onPress={() => siap && terapkan(siap)} />
        </Animated.View>
      </View>
    </Modal>
  );
}
