import React, { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { Send } from "lucide-react-native";
import { mintaBahanRework } from "@/api/picBahan";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { payloadRework, statusRework, validasiRework } from "@/features/picBahan";
import { bolehCobaLagi } from "@/features/langkah";
import { DaftarBahanKatalog, type BarisKatalog } from "@/features/BahanKatalog";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// MINTA BAHAN REWORK — PIC Bahan (cermin ReworkMaterialSheet web). POST /production-v2/runs/:runId/build/rework-material:
// QC gagal → rework; bahan TAMBAHAN diajukan SEKALI dan sebelum PIC Meja memulai rework. Gudang mereservasi lalu menyerahkan
// lewat "Serahkan Bahan" yang sudah ada — mengajukan tidak mengeluarkan stok.
export default function BahanRework() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const c = card.data;
  const st = c ? statusRework(c) : { kind: "NONE" as const };
  const [lines, setLines] = useState<BarisKatalog[]>([]);
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-rwm-${randomUUID()}`);
  const ubah = (v: BarisKatalog[]) => { setLines(v); setGalat(null); kunci.current = `pm-rwm-${randomUUID()}`; };

  const kirim = async () => {
    if (!c) return;
    const v = validasiRework(lines);
    if (v) { setGalat(v); return; }
    setBusy(true); setGalat(null);
    try {
      await mintaBahanRework(c.runId, c.revision, payloadRework(lines), kunci.current);
      await qc.invalidateQueries();
      Alert.alert("Terkirim", "Permintaan bahan rework terkirim ke Gudang.");
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-rwm-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      if (e instanceof ApiError && (e.code === "QC_REVISION_CONFLICT" || e.code === "STEP_REVISION_CONFLICT")) void card.refetch();
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen lembar header={<NavBar judul="Minta Bahan Rework" kembali="Batal" />} bottomPad={140}>
        {card.isLoading ? <StateView kind="loading" title="Memuat…" /> : null}
        {card.error ? <StateView kind="error" title="Kartu tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}
        {c && st.kind === "REQUESTED" ? <StateView kind="empty" title="Sudah diminta" text={`Permintaan ${st.issue.issueNumber ?? ""} · status Gudang: ${st.issue.status}.`} /> : null}
        {c && st.kind === "NONE" ? <StateView kind="empty" title="Tidak ada rework terbuka" text="Bahan rework hanya bisa diminta setelah QC memutuskan gagal dan sebelum rework dimulai." /> : null}

        {c && st.kind === "OPEN" ? (
          <>
            <Card style={{ backgroundColor: TONE.blue.tint, gap: 4 }}>
              <T.Sub style={{ color: TONE.blue.text }}>{c.unit.unitCode}{c.assembly?.round ? ` · putaran ${c.assembly.round}` : ""}</T.Sub>
              <T.Caption style={{ color: TONE.blue.text }}>QC memutuskan gagal → rework. Ajukan bahan TAMBAHAN yang dibutuhkan; Gudang mereservasi lalu menyerahkannya. Permintaan hanya bisa diajukan SEKALI dan sebelum PIC Meja memulai rework. Mengajukan tidak mengeluarkan stok.</T.Caption>
            </Card>
            <T.Headline style={{ marginHorizontal: 4 }}>Bahan tambahan</T.Headline>
            <DaftarBahanKatalog lines={lines} onChange={ubah} qtyLabel="Jumlah tambahan" />
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {c && st.kind === "OPEN" ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine, gap: 6 }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — kirim saat sinyal kembali.</T.Caption> : null}
          <Button kind="success" icon={<Send color="#fff" size={20} />} label="Ajukan Bahan Rework ke Gudang" onPress={() => void kirim()} busy={busy} disabled={!online} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
