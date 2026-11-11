import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { tundaPekerjaan } from "@/api/aksi";
import { pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { ALASAN_TUNDA, bolehCobaLagi, tundaSah, type AlasanTunda } from "@/features/langkah";
import { Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// TUNDA PEKERJAAN — POST /production-v2/runs/:runId/delay. "Menunggu bahan" butuh daftar bahan Gudang → tetap di SANSS Web.
export default function Tunda() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const [alasan, setAlasan] = useState<AlasanTunda>("ARAHAN");
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-tunda-${randomUUID()}`);
  const c = card.data;

  const kirim = async () => {
    if (!c) return;
    setBusy(true); setGalat(null);
    try {
      await tundaPekerjaan({ runId: c.runId, revision: c.revision, workCenterId: c.workCenterId }, alasan, catatan, kunci.current);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-tunda-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      void card.refetch();
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen header={<NavBar judul="Tunda Pekerjaan" kembali="Batal" />} bottomPad={40}>
        {card.isLoading ? <StateView kind="loading" /> : null}
        {c ? (
          <>
            <T.Headline style={{ marginHorizontal: 4 }}>Kenapa pekerjaan ditunda?</T.Headline>
            <PilihanChip options={ALASAN_TUNDA.map((a) => ({ value: a.key, label: a.label }))} value={[alasan]} onChange={(v) => v[0] && setAlasan(v[0])} />
            <Isian label={alasan === "LAINNYA" ? "Jelaskan alasannya (wajib)" : "Keterangan (opsional)"} value={catatan} onChange={setCatatan} multiline />
            <Card style={{ backgroundColor: TONE.orange.tint }}>
              <T.Sub style={{ color: TONE.orange.text }}>Kurang bahan? Laporkan lewat SANSS Web (Aplikasi Meja → Tunda → Menunggu bahan) supaya Gudang langsung melihat daftar bahannya.</T.Sub>
            </Card>
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
            <Button label="Tunda Pekerjaan" kind="danger" onPress={() => void kirim()} busy={busy} disabled={!online || !tundaSah(alasan, catatan)} />
            {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — kirim saat sinyal kembali.</T.Caption> : null}
          </>
        ) : null}
      </Screen>
    </View>
  );
}
