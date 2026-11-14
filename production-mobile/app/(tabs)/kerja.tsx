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
import { Kepala, KeteranganPanel, PilLive, Screen, Section, StatKaca, StateView, T } from "@/design/ui";
import { tanggalPanjangWib } from "@/lib/waktu";

// KERJA — "Antrean Saya" PIC Meja/Corner. Urutan & isi dari server (GET /production-v2/worker/:lane + antrean V1),
// diperbarui tiap 20 detik. Nomor 1 = kerjakan duluan (urutan yang diatur Admin di Target).
// Segmen "PIC Bahan" (GET /production-v2/worker/material) muncul hanya bila akun ini PIC Bahan dari pekerjaan aktif.
// Susunan layar mengikuti mockup "Beranda PIC Meja": kepala · kartu kaca "Sedang dikerjakan" · tiga kotak angka · panel antrean.
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
  const keUnit = (path: "/media/[runId]" | "/tunda/[runId]", runId: string | null) => (runId ? () => router.push({ pathname: path, params: { runId } }) : undefined);
  const muatUlang = () => { void v2.refetch(); void v1.refetch(); void bahan.refetch(); };
  const tanpaProfil = v2.data && v2.data.readerMode === "COHORT" && !v2.data.operator;
  const lewat = antrean.filter((k) => k.terlambat).length + (aktif?.terlambat ? 1 : 0);

  return (
    <Screen refreshing={v2.isRefetching} onRefresh={muatUlang}>
      <Kepala foto={user?.avatarUrl}
        inisial={inisial(user?.name)}
        keterangan={`${lane === "material" ? "PIC Bahan" : lane === "corner" ? "Meja Corner" : "Meja Bongkar"} · ${tanggalPanjangWib()}`}
        judul={`Semangat, ${(user?.name ?? "").split(" ")[0] || "Tim"}`}
        kanan={<PilLive putus={!!v2.error} />}
      />

      <Segmented value={lane} onChange={setLane} options={[{ key: "table", label: "Meja Bongkar" }, { key: "corner", label: "Meja Corner" }, ...(adaBahan ? [{ key: "material" as const, label: "PIC Bahan" }] : [])]} />

      {v2.isLoading ? <StateView kind="loading" title="Memuat antrean…" /> : null}
      {v2.error ? <StateView kind="error" title="Antrean tidak bisa dimuat" text={pesanUntukPengguna(v2.error)} onRetry={muatUlang} /> : null}
      {tanpaProfil ? (
        <StateView kind="empty" title="Akun belum terdaftar sebagai operator" text="Minta Admin Produksi menambahkan kamu di Pengaturan → Operator, lalu tarik layar ini untuk memuat ulang." />
      ) : null}

      {!v2.isLoading && !v2.error ? (
        <>
          {aktif ? <KartuAktif k={aktif} onPress={buka(aktif.runId)} onMedia={keUnit("/media/[runId]", aktif.runId)} onTunda={keUnit("/tunda/[runId]", aktif.runId)} /> : null}

          {/* mockup: tiga kotak angka kaca. Angkanya dihitung dari antrean server milik akun ini (bukan contoh). */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <StatKaca n={aktif ? 1 : 0} label="Dikerjakan" />
            <StatKaca n={antrean.length} label="Di antrean" />
            <StatKaca n={lewat} label="Lewat target" />
          </View>

          <Section title={aktif ? "Antrean berikutnya" : "Antrean"} right={<KeteranganPanel>urutan dari Admin</KeteranganPanel>}>
            {antrean.length ? antrean.map((k, i) => <BarisAntrean key={k.key} k={k} pertama={i === 0} onPress={buka(k.runId)} />) : (
              <StateView kind="empty" title={aktif ? "Tidak ada antrean berikutnya" : "Belum ada kasur"} text="Kasur akan muncul di sini begitu Admin Produksi menugaskannya ke kamu." />
            )}
          </Section>
          {v1.error ? <T.Caption style={{ textAlign: "center" }}>Sebagian unit lama tidak termuat. Tarik untuk mencoba lagi.</T.Caption> : null}
        </>
      ) : null}
    </Screen>
  );
}

const inisial = (n?: string | null) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
