import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { simpanPicMeja, usePapan, useRefsJadwal } from "@/api/jadwal";
import { pesanUntukPengguna } from "@/api/errors";
import { labelMeja, opsiLini } from "@/features/jadwal";
import { bolehCobaLagi } from "@/features/langkah";
import { PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// PIC BAWAAN MEJA pada satu tanggal — PUT /production-v2/stations/:code/pic. Unit yang dijadwalkan ke meja ini dengan pilihan
// "Ikuti bawaan" memakai PIC ini (dipilih server). Penugasan unit yang SUDAH ada tidak diubah diam-diam.
export default function PicMeja() {
  const { kode, tgl } = useLocalSearchParams<{ kode: string; tgl: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const papan = usePapan(tgl ?? "", !!tgl);
  const refs = useRefsJadwal();
  const meja = papan.data?.stations?.find((m) => m.code === kode) ?? null;
  const [pilih, setPilih] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-pic-${randomUUID()}`);
  const sekarang = meja?.defaultPic?.operatorId ?? "";
  const nilai = pilih ?? sekarang;
  const opsi = refs.data ? opsiLini(refs.data.operators, "TABLE", meja?.defaultPic ? { id: meja.defaultPic.operatorId, name: meja.defaultPic.name } : null) : [];

  const simpan = async () => {
    if (!kode || !tgl) return;
    setBusy(true); setGalat(null);
    try {
      await simpanPicMeja(kode, tgl, nilai || null, kunci.current);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-pic-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen header={<NavBar judul={`PIC ${labelMeja(kode ?? "")}`} kembali="Batal" />} bottomPad={40}>
        <T.Sub style={{ marginHorizontal: 4 }}>Tanggal {tgl}. Unit baru di meja ini otomatis memakai PIC bawaan, kecuali Admin memilih PIC lain untuk unit tertentu.</T.Sub>
        {papan.isLoading || refs.isLoading ? <StateView kind="loading" /> : null}
        {refs.error ? <StateView kind="error" title="Daftar PIC tidak bisa dimuat" text={pesanUntukPengguna(refs.error)} onRetry={() => void refs.refetch()} /> : null}
        {refs.data && !opsi.length ? (
          <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Belum ada operator berlini Meja Bongkar. Tetapkan lini operator di SANSS Web → Pengaturan Produksi → Operator.</T.Sub></Card>
        ) : null}
        {refs.data && opsi.length ? (
          <PilihanChip
            label="PIC bawaan"
            options={[{ value: "", label: "Kosongkan" }, ...opsi.map((o) => ({ value: o.id, label: o.lama ? `${o.name} (belum berlini)` : o.name }))]}
            value={[nilai]}
            onChange={(v) => { setPilih(v[0] ?? ""); kunci.current = `pm-pic-${randomUUID()}`; }}
          />
        ) : null}
        {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
        <Button label="Simpan PIC" onPress={() => void simpan()} busy={busy} disabled={!online || !refs.data || nilai === sekarang} />
      </Screen>
    </View>
  );
}
