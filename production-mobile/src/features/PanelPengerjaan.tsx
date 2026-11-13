import React from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, ClipboardList, PackagePlus, Settings2, Wrench } from "lucide-react-native";
import { useKomponen } from "@/api/komponen";
import { useLayout } from "@/api/production";
import type { RunCard } from "@/api/types";
import { useSession } from "@/auth/session";
import { BAGIAN_KOMPONEN, URUTAN_TAMPIL, type KunciBagian } from "./komponen";
import { bolehIsiBom, pengaturanBahan, sayaPicBahan, statusRework, teksCorner, teksRacikan } from "./picBahan";
import { Button, Card, Chip, Divider, Section, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// PANEL DETAIL UNIT — cermin BuildInfo, PicBahanInfo, aksi lane PIC Bahan, dan panel Catatan Komponen di Aplikasi Meja web.

const Baris = ({ label, nilai }: { label: string; nilai: string }) => (
  <View style={{ gap: 2 }}>
    <T.Caption>{label}</T.Caption>
    <T.Sub style={{ color: C.ink }}>{nilai}</T.Sub>
  </View>
);

/** Ringkasan jalur Pengerjaan Pesanan (BUILD) / PIC Bahan LAYANAN + tombol aksi PIC Bahan & pengaturan Lead. */
export function PanelPengerjaan({ card }: { card: RunCard }) {
  const router = useRouter();
  const l = useLayout();
  const userId = useSession((s) => s.user?.id);
  const build = card.track === "BUILD";
  const p = pengaturanBahan(card);
  if (!build && !p) return null;

  const pakai = p?.record?.materials ?? [];
  const sayaPic = sayaPicBahan(card, userId, l.executeAny);
  const rework = statusRework(card);
  const racikan = build ? teksRacikan(card.racikan ?? p?.record?.racikan) : null;

  return (
    <Section title={build ? "Pengerjaan Pesanan" : "PIC Bahan"}>
      <Card style={{ gap: 10 }}>
        {build && card.product?.problem ? (
          <View style={{ backgroundColor: TONE.orange.tint, borderRadius: 12, padding: 10 }}>
            <T.Sub style={{ color: TONE.orange.text }}>Jenis produk perlu dikonfirmasi: {card.product.problem}. Minta Sales memperbaiki pada order.</T.Sub>
          </View>
        ) : null}
        <Baris label="PIC Bahan" nilai={p?.materialOperator?.name || "Belum ditugaskan"} />
        {build ? <Baris label="Corner" nilai={teksCorner(p?.corner)} /> : null}
        {build && card.product?.flow !== "NON_KASUR" ? <Baris label="Racikan" nilai={racikan || "Belum dicatat"} /> : null}
        <Baris label={`${build ? "Bahan dipakai" : "Pemakaian aktual"}${p?.record?.version ? ` (versi ${p.record.version})` : ""}`} nilai={pakai.length ? pakai.map((m) => `${m.name || m.code} ${m.qty}`).join(", ") : "Belum dicatat"} />
        {!build ? <T.Caption>Racikan fondasi/lapisan ditentukan PIC Meja/PIC QC di Catatan Komponen. Mencatat rencana atau pemakaian tidak mengeluarkan stok.</T.Caption> : null}
        {rework.kind === "REQUESTED" ? <Chip label={`Bahan rework ${rework.issue.issueNumber ?? ""} · ${rework.issue.status}`} tone="orange" /> : null}

        {sayaPic ? (
          <View style={{ gap: 8 }}>
            <Button kind="primary" icon={<ClipboardList color="#fff" size={18} />} label={build ? "Catat Racikan & Bahan" : "Catat Bahan Dipakai"}
              onPress={() => router.push({ pathname: "/catat-bahan/[runId]", params: { runId: card.runId } })} />
            {bolehIsiBom(card) ? (
              <Button kind="tinted" icon={<PackagePlus color={TONE.blue.text} size={18} />} label={card.bom?.length ? "Revisi Rencana Bahan (BOM)" : "Isi Rencana Bahan (BOM)"}
                onPress={() => router.push({ pathname: "/rencana-bahan/[runId]", params: { runId: card.runId } })} />
            ) : null}
            {rework.kind === "OPEN" ? (
              <Button kind="tinted" tone="orange" icon={<Wrench color={TONE.orange.text} size={18} />} label="Minta Bahan Rework"
                onPress={() => router.push({ pathname: "/bahan-rework/[runId]", params: { runId: card.runId } })} />
            ) : null}
          </View>
        ) : null}
        {build && l.admin ? (
          <Button kind="tinted" icon={<Settings2 color={TONE.blue.text} size={18} />} label="Atur Corner & PIC Bahan"
            onPress={() => router.push({ pathname: "/atur-pengerjaan/[runId]", params: { runId: card.runId } })} />
        ) : null}
      </Card>
    </Section>
  );
}

/** Daftar Catatan Komponen unit (status per bagian) → buka layar isian. Server menegakkan siapa yang boleh menulis. */
export function PanelKomponen({ card }: { card: RunCard }) {
  const router = useRouter();
  const q = useKomponen(card.unit.id);
  if (q.data?.readerMode === "OFF") return null;
  const bagian = URUTAN_TAMPIL;
  return (
    <Section title="Catatan Komponen">
      <Card padded={false}>
        {q.isLoading ? <T.Sub style={{ padding: 14 }}>Memuat…</T.Sub> : null}
        {q.error ? <T.Sub style={{ padding: 14, color: TONE.red.text }}>Catatan tidak bisa dimuat.</T.Sub> : null}
        {q.data ? bagian.map((b: KunciBagian, i) => {
          const e = q.data?.sections?.[b] ?? null;
          return (
            <View key={b}>
              {i > 0 ? <Divider inset={14} /> : null}
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/komponen/[unitId]", params: { unitId: card.unit.id, bagian: b, runId: card.runId } })}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 56 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T.Headline numberOfLines={1} style={{ fontSize: 15 }}>{BAGIAN_KOMPONEN[b].label}</T.Headline>
                  <T.Caption numberOfLines={1}>{e ? `Versi ${e.version}${e.actor?.name ? ` · ${e.actor.name}` : ""}` : "Belum dicatat"}</T.Caption>
                </View>
                {BAGIAN_KOMPONEN[b].qc ? <Chip label="PIC QC" tone="teal" /> : null}
                <ChevronRight color={C.ink3} size={18} />
              </Pressable>
            </View>
          );
        }) : null}
      </Card>
    </Section>
  );
}
