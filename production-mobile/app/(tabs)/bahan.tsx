import React, { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, PackageCheck } from "lucide-react-native";
import { bulanWib, kelompokPengajuan, useBahanBelum, usePengajuanMenunggu, type BarisOrderProduksi, type PengajuanMenunggu } from "@/api/bahanQc";
import { pesanUntukPengguna } from "@/api/errors";
import { Segmented } from "@/design/Segmented";
import { Baris, Card, Chip, GlassOnBlue, HeroCard, KepalaJudul, KeteranganPanel, Screen, Section, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";

// BAHAN — pendataan bahan oleh tim QC & Dokumentasi (keputusan Owner 14 Nov 2026).
// Daftar = unit yang SUDAH dikerjakan/selesai tetapi BELUM punya catatan pemakaian bahan apa pun, per bulan order masuk (WIB).
// Klasifikasi & hitungan dari server (filter "Bahan belum dicatat" yang sama dengan web Order Produksi) — tidak dihitung ulang di HP.
export default function Bahan() {
  const router = useRouter();
  const [geser, setGeser] = useState<"0" | "-1">("0");
  const bulan = bulanWib(Number(geser));
  const q = useBahanBelum(Number(geser));
  const aju = usePengajuanMenunggu();
  const menunggu = kelompokPengajuan(aju.data?.pengajuan);
  const semua = q.data?.units ?? [];
  const rows = semua.filter((r) => !menunggu.has(r.id));
  const diajukan = semua.filter((r) => menunggu.has(r.id));
  const total = rows.length;
  const buka = (id: string) => () => router.push({ pathname: "/bahan/[unitId]", params: { unitId: id } });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <KepalaJudul keterangan="Pendataan bahan · QC & Dokumentasi" judul="Bahan" />

      <HeroCard>
        <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>Order yang belum ada bahannya</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: 56, lineHeight: 60, letterSpacing: -1.5, color: C.white, fontVariant: ["tabular-nums"] }}>{q.isLoading ? "…" : total}</Text>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ flex: 1, fontFamily: F.semibold, fontSize: 14, color: "#DCEBFF", paddingBottom: 9 }}>unit · {bulan.label}{diajukan.length ? ` · ${diajukan.length} menunggu verifikasi` : ""}</Text>
        </View>
        <GlassOnBlue style={{ borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 13, lineHeight: 18, color: C.white }}>Unit yang sudah dikerjakan atau selesai, tetapi belum ada catatan pemakaian bahan. Catatanmu menjadi pengajuan yang diverifikasi Admin.</Text>
        </GlassOnBlue>
      </HeroCard>

      <Segmented value={geser} onChange={setGeser} options={[{ key: "0", label: "Bulan ini" }, { key: "-1", label: "Bulan lalu" }]} />

      {q.isLoading ? <StateView kind="loading" title="Memuat daftar…" /> : null}
      {q.error ? <StateView kind="error" title="Daftar tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && !rows.length && !diajukan.length ? (
        <Card style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
          <PackageCheck size={32} color={TONE.green.text} />
          <T.Row style={{ fontSize: 15 }}>Semua sudah tercatat</T.Row>
          <T.RowSub style={{ textAlign: "center", fontSize: 13 }}>Tidak ada unit {bulan.label} yang belum punya catatan bahan.</T.RowSub>
        </Card>
      ) : null}

      {rows.length ? (
        <Section title="Perlu dicatat" right={<KeteranganPanel>order terlama dulu</KeteranganPanel>}>
          {rows.map((r) => <BarisUnit key={r.id} r={r} onPress={buka(r.id)} />)}
        </Section>
      ) : null}

      {diajukan.length ? (
        <Section title="Menunggu verifikasi Admin" right={<KeteranganPanel>{diajukan.length} unit</KeteranganPanel>}>
          {diajukan.map((r) => <BarisUnit key={r.id} r={r} aju={menunggu.get(r.id)} onPress={buka(r.id)} />)}
        </Section>
      ) : null}
    </Screen>
  );
}

function BarisUnit({ r, aju, onPress }: { r: BarisOrderProduksi; aju?: PengajuanMenunggu[]; onPress: () => void }) {
  const kasur = [r.merk, r.ukuran].filter(Boolean).join(" ");
  const selesai = r.status === "DELIVERED";
  return (
    <Baris accessibilityLabel={`Catat bahan ${r.unitCode}`} onPress={onPress}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T.Row numberOfLines={1}>{r.unitCode}</T.Row>
        <T.RowSub numberOfLines={1}>{[r.order?.customer?.name, kasur].filter(Boolean).join(" · ") || "—"}</T.RowSub>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          {r.adopsi?.kerja?.label ? <Chip label={r.adopsi.kerja.label} tone="blue" /> : null}
          {selesai ? <Chip label="Terkirim · pembetulan" tone="orange" /> : null}
          {aju?.length ? <Chip label={`Diajukan${aju[0]?.pengaju ? ` oleh ${aju[0].pengaju}` : ""}`} tone="green" /> : null}
        </View>
      </View>
      <ChevronRight color={C.ink3} size={18} />
    </Baris>
  );
}
