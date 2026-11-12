import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useV1Queue, useWorkerQueue, type Lane } from "@/api/production";
import { useAntreanBahan } from "@/api/picBahan";
import { pesanUntukPengguna } from "@/api/errors";
import { useSession } from "@/auth/session";
import { BarisAntrean, KartuAktif } from "@/features/KartuKerja";
import { susunAntrean } from "@/features/model";
import { Segmented } from "@/design/Segmented";
import { Card, Chip, Divider, Screen, Section, StateView, T } from "@/design/ui";
import { TONE } from "@/design/tokens";
import { tanggalPanjangWib } from "@/lib/waktu";

// KERJA — "Antrean Saya" PIC Meja/Corner. Urutan & isi dari server (GET /production-v2/worker/:lane + antrean V1),
// diperbarui tiap 20 detik. Nomor 1 = kerjakan duluan (urutan yang diatur Admin di Target).
// Segmen "PIC Bahan" (GET /production-v2/worker/material) muncul hanya bila akun ini PIC Bahan dari pekerjaan aktif.
export default function Kerja() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [pilihan, setLane] = useState<Lane | "material">("table");
  const bahan = useAntreanBahan();
  const adaBahan = (bahan.data?.items.length ?? 0) > 0;
  const lane: Lane | "material" = pilihan === "material" && !adaBahan ? "table" : pilihan;
  const laneMeja: Lane = lane === "material" ? "table" : lane;
  const v2Meja = useWorkerQueue(laneMeja, lane !== "material");
  const v1 = useV1Queue(laneMeja, lane !== "material");
  const v2 = lane === "material" ? bahan : v2Meja;

  const { aktif, antrean } = useMemo(() => susunAntrean(v2.data?.items ?? [], lane === "material" ? [] : v1.data?.items ?? []), [v2.data, v1.data, lane]);
  const buka = (runId: string | null) => (runId ? () => router.push({ pathname: "/unit/[runId]", params: { runId } }) : undefined);
  const muatUlang = () => { void v2.refetch(); void v1.refetch(); void bahan.refetch(); };
  const tanpaProfil = v2.data && v2.data.readerMode === "COHORT" && !v2.data.operator;

  return (
    <Screen refreshing={v2.isRefetching} onRefresh={muatUlang}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 4 }}>
        <View style={{ flex: 1 }}>
          <T.Eyebrow>{tanggalPanjangWib()}</T.Eyebrow>
          <T.LargeTitle accessibilityRole="header">Kerja</T.LargeTitle>
        </View>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: TONE.indigo.fill, alignItems: "center", justifyContent: "center" }}>
          <T.Headline style={{ color: "#fff", fontSize: 15 }}>{inisial(user?.name)}</T.Headline>
        </View>
      </View>

      <Segmented value={lane} onChange={setLane} options={[{ key: "table", label: "Meja Bongkar" }, { key: "corner", label: "Meja Corner" }, ...(adaBahan ? [{ key: "material" as const, label: "PIC Bahan" }] : [])]} />

      {v2.isLoading ? <StateView kind="loading" title="Memuat antrean…" /> : null}
      {v2.error ? <StateView kind="error" title="Antrean tidak bisa dimuat" text={pesanUntukPengguna(v2.error)} onRetry={muatUlang} /> : null}
      {tanpaProfil ? (
        <StateView kind="empty" title="Akun belum terdaftar sebagai operator" text="Minta Admin Produksi menambahkan kamu di Pengaturan → Operator, lalu tarik layar ini untuk memuat ulang." />
      ) : null}

      {!v2.isLoading && !v2.error ? (
        <>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T.Headline>{antrean.length + (aktif ? 1 : 0)} {lane === "material" ? "pekerjaan PIC Bahan" : "kasur di antreanmu"}</T.Headline>
              <T.Sub>{lane === "material" ? "Catat racikan & bahan dipakai dari detail unit" : "Urutan dari Admin · diperbarui otomatis"}</T.Sub>
            </View>
            <Chip label="Live" tone="green" />
          </Card>

          {aktif ? (
            <Section title="Sedang dikerjakan">
              <KartuAktif k={aktif} onPress={buka(aktif.runId)} />
            </Section>
          ) : null}

          <Section title={aktif ? "Antrean berikutnya" : "Antrean"}>
            {antrean.length ? (
              <Card padded={false}>
                {antrean.map((k, i) => (
                  <View key={k.key}>
                    {i > 0 ? <Divider inset={70} /> : null}
                    <BarisAntrean k={k} onPress={buka(k.runId)} />
                  </View>
                ))}
              </Card>
            ) : (
              <StateView kind="empty" title="Belum ada kasur" text="Kasur akan muncul di sini begitu Admin Produksi menugaskannya ke kamu." />
            )}
          </Section>
          {v1.error ? <T.Caption style={{ textAlign: "center" }}>Sebagian unit lama tidak termuat. Tarik untuk mencoba lagi.</T.Caption> : null}
        </>
      ) : null}
    </Screen>
  );
}

const inisial = (n?: string | null) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
