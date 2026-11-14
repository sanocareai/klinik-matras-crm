import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { useAndon } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import { formatMenit, ringkasPapan } from "@/features/model";
import { perluPerhatian, ringkasMeja } from "@/features/papan";
import { Baris, Chip, IconOrb, KepalaJudul, KeteranganPanel, PilLive, Screen, Section, StatKaca, StateView, TeksBaris } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { jamWib } from "@/lib/waktu";

// PAPAN — live per meja hari ini (sumber sama dengan Andon TV: GET /production-v2/andon), diperbarui tiap 20 detik.
// Tampilan mengikuti mockup v2: kotak angka kaca di atas biru, lalu panel kaca berisi baris putih.
export default function Papan() {
  const router = useRouter();
  const q = useAndon();
  const b = q.data;
  const kpi = ringkasPapan(b);
  const meja = useMemo(() => (b?.stations ?? []).map(ringkasMeja), [b]);
  const perhatian = useMemo(() => perluPerhatian(b?.stations ?? []), [b]);
  const buka = (runId: string) => router.push({ pathname: "/unit/[runId]", params: { runId } });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <KepalaJudul
        keterangan={q.error ? "Terputus — menampilkan data terakhir" : `Diperbarui ${jamWib(b?.generatedAt)}`}
        judul="Papan"
        kanan={<View style={{ paddingBottom: 8 }}><PilLive putus={!!q.error} /></View>}
      />

      {q.isLoading ? <StateView kind="loading" title="Memuat papan…" /> : null}
      {q.error && !b ? <StateView kind="error" title="Papan tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {b?.readerMode === "OFF" ? <StateView kind="empty" title="Produksi V2 belum aktif" text="Papan live tampil setelah unit masuk Produksi V2 di SANSS Web." /> : null}

      {b && b.readerMode !== "OFF" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <StatKaca rapat n={kpi.target} label="Target" />
            <StatKaca rapat n={kpi.selesai} label="Selesai" />
            <StatKaca rapat n={kpi.dikerjakan} label="Dikerjakan" />
            <StatKaca rapat n={kpi.terhambat} label="Terhambat" />
          </View>

          {perhatian.length ? (
            <Section title="Butuh perhatian" right={<KeteranganPanel>{perhatian.length} unit</KeteranganPanel>}>
              {perhatian.map((p) => (
                <Baris key={p.runId} onPress={() => buka(p.runId)} accessibilityLabel={`${p.kode}, ${p.alasan}`}>
                  <IconOrb size={36} nada="orbOranye"><AlertTriangle color={C.white} size={18} strokeWidth={2.4} /></IconOrb>
                  <TeksBaris judul={`${p.kode} · ${p.customer}`} sub={`${p.alasan} · ${p.meja}`} />
                </Baris>
              ))}
            </Section>
          ) : null}

          <Section title="Per meja" right={<KeteranganPanel>sekarang</KeteranganPanel>}>
            {meja.map((m) => (
              <Baris key={m.code} onPress={m.sekarang ? () => buka(m.sekarang!.runId) : undefined}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: m.jumlah ? TONE.blue.tint : "#F2F6FB", alignItems: "center", justifyContent: "center" }}>
                  <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: 15, color: m.jumlah ? TONE.blue.text : "#42526B", fontVariant: ["tabular-nums"] }}>{m.jumlah}</Text>
                </View>
                <TeksBaris judul={`${m.label} · ${m.pic}`} sub={m.sekarang ? `${m.sekarang.kode} · ${m.sekarang.tahap}` : "Belum ada yang dikerjakan"} />
                {m.status === "kosong" ? <Chip label="Kosong" /> : m.status === "terhambat" ? <Chip label="Terhambat" tone="orange" /> : <Chip label={formatMenit(m.sekarang?.menit)} tone={m.sekarang?.tone ?? "blue"} />}
              </Baris>
            ))}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
