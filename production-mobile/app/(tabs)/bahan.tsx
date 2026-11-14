import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, PackageCheck } from "lucide-react-native";
import { bulanWib, kelompokPengajuan, useBahanBelum, usePengajuanMenunggu, type BarisOrderProduksi, type PengajuanMenunggu } from "@/api/bahanQc";
import { pesanUntukPengguna } from "@/api/errors";
import { Segmented } from "@/design/Segmented";
import { Card, Chip, Divider, GlassOnBlue, HeroCard, PressableScale, Screen, Section, StateView, T } from "@/design/ui";
import { C, F } from "@/design/tokens";

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

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <View style={{ paddingHorizontal: 4 }}>
        <T.Eyebrow>Pendataan bahan · QC &amp; Dokumentasi</T.Eyebrow>
        <T.LargeTitle accessibilityRole="header">Bahan</T.LargeTitle>
      </View>

      <HeroCard>
        <T.Headline style={{ color: C.white, fontFamily: F.bold, fontSize: 15 }}>Order yang belum ada bahannya</T.Headline>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <T.LargeTitle style={{ color: C.white, fontSize: 56, lineHeight: 60 }}>{q.isLoading ? "…" : total}</T.LargeTitle>
          <T.Sub style={{ color: "#DCEBFF", paddingBottom: 10, fontFamily: F.semibold }}>unit · {bulan.label}{diajukan.length ? ` · ${diajukan.length} menunggu verifikasi` : ""}</T.Sub>
        </View>
        <GlassOnBlue>
          <T.Sub style={{ color: C.white }}>Unit yang sudah dikerjakan atau selesai, tetapi belum ada catatan pemakaian bahan. Catatanmu menjadi pengajuan yang diverifikasi Admin.</T.Sub>
        </GlassOnBlue>
      </HeroCard>

      <Segmented value={geser} onChange={setGeser} options={[{ key: "0", label: "Bulan ini" }, { key: "-1", label: "Bulan lalu" }]} />

      {q.isLoading ? <StateView kind="loading" title="Memuat daftar…" /> : null}
      {q.error ? <StateView kind="error" title="Daftar tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && !rows.length && !diajukan.length ? (
        <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
          <PackageCheck size={34} color="#15803D" />
          <T.Headline>Semua sudah tercatat</T.Headline>
          <T.Sub style={{ textAlign: "center" }}>Tidak ada unit {bulan.label} yang belum punya catatan bahan.</T.Sub>
        </Card>
      ) : null}

      {rows.length ? (
        <Section title="Perlu dicatat" right={<T.Caption>order terlama dulu</T.Caption>}>
          <Card padded={false}>
            {rows.map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <Divider inset={16} /> : null}
                <BarisUnit r={r} onPress={() => router.push({ pathname: "/bahan/[unitId]", params: { unitId: r.id } })} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {diajukan.length ? (
        <Section title="Menunggu verifikasi Admin">
          <Card padded={false}>
            {diajukan.map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <Divider inset={16} /> : null}
                <BarisUnit r={r} aju={menunggu.get(r.id)} onPress={() => router.push({ pathname: "/bahan/[unitId]", params: { unitId: r.id } })} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

function BarisUnit({ r, aju, onPress }: { r: BarisOrderProduksi; aju?: PengajuanMenunggu[]; onPress: () => void }) {
  const kasur = [r.merk, r.ukuran].filter(Boolean).join(" ");
  const selesai = r.status === "DELIVERED";
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`Catat bahan ${r.unitCode}`} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 68 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T.Headline numberOfLines={1}>{r.unitCode}</T.Headline>
        <T.Sub numberOfLines={1}>{[r.order?.customer?.name, kasur].filter(Boolean).join(" · ") || "—"}</T.Sub>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {r.adopsi?.kerja?.label ? <Chip label={r.adopsi.kerja.label} tone="blue" /> : null}
          {selesai ? <Chip label="Terkirim · pembetulan" tone="orange" /> : null}
          {aju?.length ? <Chip label={`Diajukan${aju[0]?.pengaju ? ` oleh ${aju[0].pengaju}` : ""}`} tone="green" /> : null}
        </View>
      </View>
      <ChevronRight color={C.ink3} size={20} />
    </PressableScale>
  );
}
