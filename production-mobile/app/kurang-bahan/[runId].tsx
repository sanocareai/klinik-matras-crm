import React, { useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { Check, PackageX, Search } from "lucide-react-native";
import { cariBahan, laporKurangBahan } from "@/api/aksi";
import { pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { bahanUrutBom, bodyKurangBahan, bolehCobaLagi } from "@/features/langkah";
import { kodePendek } from "@/features/model";
import { Isian } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";

// LAPOR KURANG BAHAN — POST /production-v2/runs/:runId/material-shortage (cermin ShortageSheet web).
// Kartu tampil "Tertunda — menunggu bahan" dan Gudang langsung melihat daftarnya; pekerjaan dilanjutkan setelah Gudang menyerahkan bahan.
// Daftar: BOM unit dulu, lalu katalog bahan aktif (GET /production-v2/materials/search).
export default function KurangBahan() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const [cari, setCari] = useState("");
  const katalog = useQuery({ queryKey: ["bahan", cari.trim()], queryFn: () => cariBahan(cari.trim()), staleTime: 60_000 });
  const [dipilih, setDipilih] = useState<Record<string, { qty: string }>>({});
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-kurang-${randomUUID()}`);
  const c = card.data;

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const semua = bahanUrutBom(c?.bom, (katalog.data?.items ?? []).map((m) => ({ id: m.id, code: m.code, name: m.name })));
    return (q ? semua.filter((m) => `${m.name} ${m.code}`.toLowerCase().includes(q)) : semua).slice(0, 40);
  }, [c?.bom, katalog.data, cari]);
  const jumlah = Object.keys(dipilih).length;

  const ubah = (fn: (x: Record<string, { qty: string }>) => Record<string, { qty: string }>) => { setDipilih(fn); setGalat(null); kunci.current = `pm-kurang-${randomUUID()}`; };

  const kirim = async () => {
    if (!c) return;
    const body = bodyKurangBahan(c, dipilih, catatan);
    if (!body) { setGalat("Pilih bahan yang kurang."); return; }
    setBusy(true); setGalat(null);
    try {
      await laporKurangBahan(c.runId, body, kunci.current);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-kurang-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      void card.refetch();
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen lembar header={<NavBar judul="Bahan Kurang" kembali="Batal" />} bottomPad={140}>
        {card.isLoading ? <StateView kind="loading" /> : null}
        {c ? (
          <>
            <Card style={{ backgroundColor: TONE.orange.tint, gap: 4 }}>
              <T.Headline style={{ color: TONE.orange.text }}>{kodePendek(c.unit.unitCode)} · menunggu bahan</T.Headline>
              <T.Sub style={{ color: TONE.orange.text }}>Kartu tampil “Tertunda — menunggu bahan” dan Gudang langsung melihat daftar ini. Lanjutkan setelah Gudang menyerahkan bahannya.</T.Sub>
            </Card>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 12, paddingHorizontal: 12, height: 46 }}>
              <Search color={C.ink3} size={18} />
              <TextInput accessibilityLabel="Cari bahan" value={cari} onChangeText={setCari} placeholder="Cari bahan…" placeholderTextColor={C.ink3}
                style={{ flex: 1, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
            </View>
            {katalog.error ? <T.Caption style={{ color: TONE.red.text }}>Katalog tidak bisa dimuat — bahan dari rencana (BOM) tetap bisa dipilih.</T.Caption> : null}

            {daftar.length ? (
              <View style={{ gap: 8 }}>
                {daftar.map((m) => {
                  const v = dipilih[m.id];
                  const on = !!v;
                  return (
                    <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: on ? TONE.blue.tint : C.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
                      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={m.name}
                        onPress={() => ubah((x) => { const n = { ...x }; if (on) delete n[m.id]; else n[m.id] = { qty: "" }; return n; })}
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: on ? TONE.blue.fill : "transparent", borderWidth: on ? 0 : 2, borderColor: "#C7C7CC" }}>
                          {on ? <Check color="#fff" size={17} strokeWidth={3.2} /> : null}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <T.Headline numberOfLines={1}>{m.name}</T.Headline>
                          <T.Caption>{m.code}</T.Caption>
                        </View>
                      </Pressable>
                      {on ? (
                        <TextInput accessibilityLabel={`Jumlah ${m.name}`} value={v.qty} onChangeText={(t) => ubah((x) => ({ ...x, [m.id]: { qty: t } }))}
                          keyboardType="decimal-pad" placeholder="Qty" placeholderTextColor={C.ink3}
                          style={{ width: 72, height: 46, borderRadius: 12, backgroundColor: C.isian, textAlign: "center", fontFamily: F.semibold, fontSize: 16, color: C.ink }} />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : katalog.isLoading ? <StateView kind="loading" /> : <StateView kind="empty" text="Bahan tidak ditemukan." />}

            <Isian label="Catatan untuk Gudang (opsional)" value={catatan} onChange={setCatatan} multiline />
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {c ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine, gap: 6 }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — kirim saat sinyal kembali.</T.Caption> : null}
          <Button kind="destructive" icon={<PackageX color="#fff" size={20} />} label={`Kirim ke Gudang (${jumlah} bahan)`} onPress={() => void kirim()} busy={busy} disabled={!online || !jumlah} />
        </View>
      ) : null}
    </View>
  );
}
