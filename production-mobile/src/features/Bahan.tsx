import React from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, CircleAlert } from "lucide-react-native";
import { ambilPratinjauSelesai } from "@/api/aksi";
import { pesanUntukPengguna } from "@/api/errors";
import type { BahanDiserahkan, CornerView, RunCard } from "@/api/types";
import { Card, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { LABEL_KONFIRMASI_SALES } from "./langkah";

// KOMPONEN TAHAP 4 — cermin MaterialLines, CornerRequestCard, dan FinishPreviewBlock di SANSS Web. Baca-saja kecuali isian jumlah bahan.

type Baris = { materialId: string; qty: string };

/** Jumlah bahan dipakai per bahan yang SUDAH diserahkan Gudang untuk unit ini (diserahkan · sisa terlihat). */
export function BahanDipakai({ diserahkan, value, onChange, kosong }: { diserahkan: BahanDiserahkan[]; value: Baris[]; onChange: (v: Baris[]) => void; kosong: string }) {
  if (!diserahkan.length) return <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{kosong}</T.Sub></Card>;
  const qtyOf = (id: string) => value.find((m) => m.materialId === id)?.qty ?? "";
  const set = (id: string, qty: string) => {
    const rest = value.filter((m) => m.materialId !== id);
    onChange(qty === "" ? rest : [...rest, { materialId: id, qty }]);
  };
  return (
    <View style={{ gap: 8 }}>
      {diserahkan.map((m) => (
        <View key={m.materialId} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T.Headline numberOfLines={1}>{m.name}</T.Headline>
            <T.Caption numberOfLines={1}>
              {m.code} · diserahkan {m.qty} {String(m.uom ?? "").toLowerCase()}{m.remainingQty != null && m.remainingQty !== m.qty ? ` · sisa ${m.remainingQty}` : ""}
            </T.Caption>
          </View>
          <TextInput
            accessibilityLabel={`Jumlah ${m.name} dipakai`}
            value={qtyOf(m.materialId)}
            onChangeText={(t) => set(m.materialId, t)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={C.ink3}
            style={{ width: 76, height: 48, borderRadius: 12, backgroundColor: C.fill, textAlign: "center", fontFamily: F.semibold, fontSize: 17, color: C.ink }}
          />
        </View>
      ))}
    </View>
  );
}

/** Pemakaian bahan sudah dicatat PIC Bahan → Meja tidak mengisi lagi. */
export function BahanOlehPic({ card }: { card: Pick<RunCard, "materialPic"> }) {
  const p = card.materialPic;
  const pakai = p?.record?.materials ?? [];
  return (
    <Card style={{ gap: 4 }}>
      <T.Headline>Pemakaian bahan dicatat PIC Bahan{p?.materialOperator?.name ? `: ${p.materialOperator.name}` : ""}</T.Headline>
      <T.Sub>Racikan fondasi/lapisan ada di Catatan Komponen — tidak perlu diisi lagi di sini.</T.Sub>
      {pakai.length ? <T.Sub>Bahan dipakai: {pakai.map((m) => `${m.name || m.code} ${m.qty}`).join(", ")}</T.Sub> : null}
    </Card>
  );
}

/** Permintaan Sales untuk Corner — tidak menebak motif/warna; bila belum tertulis tampil "Perlu konfirmasi Sales". */
export function PermintaanCorner({ cv }: { cv: CornerView | null | undefined }) {
  if (!cv) return null;
  if (cv.status?.status === "TIDAK_BERLAKU") {
    return (
      <Card style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ban color={C.ink2} size={17} /><T.Headline>Corner tidak berlaku</T.Headline></View>
        <T.Sub>Alasan: {cv.status.reason ?? "—"}{cv.status.decidedBy ? ` (keputusan ${cv.status.decidedBy})` : ""}</T.Sub>
      </Card>
    );
  }
  const r = cv.request;
  const sudah = (cv.records?.start?.salesConfirmation ?? "").trim();
  const perlu = !!r?.needsSalesConfirmation && !sudah;
  const baris = (k: string, v: string) => (
    <Text style={{ fontFamily: F.regular, fontSize: 14, color: C.ink2 }}>{k}: <Text style={{ fontFamily: F.semibold, color: C.ink }}>{v}</Text></Text>
  );
  return (
    <Card style={{ gap: 6, backgroundColor: perlu ? TONE.orange.tint : C.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {perlu ? <AlertTriangle color={TONE.orange.text} size={17} /> : <CheckCircle2 color={TONE.green.text} size={17} />}
        <T.Headline>Permintaan Sales untuk Corner</T.Headline>
      </View>
      {perlu ? <T.Sub style={{ color: TONE.orange.text, fontFamily: F.bold }}>{LABEL_KONFIRMASI_SALES}</T.Sub> : null}
      {sudah ? <T.Sub style={{ color: TONE.green.text }}>Konfirmasi Sales dicatat{cv.records?.start?.byName ? ` oleh ${cv.records.start.byName}` : ""}: {sudah}</T.Sub> : null}
      {r?.noteOnly ? <T.Caption>Catatan menyebut kain, tetapi layanan ganti kain tidak dipesan.</T.Caption> : null}
      {baris("Ganti kain", r?.fabricChangeRequested ? (r.fabricItems?.length ? r.fabricItems.join(", ") : "ya (dari catatan pesanan)") : "tidak diminta")}
      {baris("Motif", !r?.fabricChangeRequested ? "—" : r.motifMentioned ? "tertulis di catatan" : "belum tertulis")}
      {baris("Warna", !r?.fabricChangeRequested ? "—" : r.colorMentioned ? "tertulis di catatan" : "belum tertulis")}
      {baris("Catatan pesanan", r?.notes || "tidak ada")}
      {r?.hint && !sudah ? <T.Sub style={{ color: TONE.orange.text }}>{r.hint}</T.Sub> : null}
    </Card>
  );
}

/** Ringkasan sebelum Konfirmasi Selesai (kontrak Corner V2) — server menegakkan ulang semua syarat saat dikirim. */
export function PratinjauSelesai({ runId, revision }: { runId: string; revision: number }) {
  const q = useQuery({ queryKey: ["finish-preview", runId, revision], queryFn: () => ambilPratinjauSelesai(runId) });
  if (q.isLoading) return <StateView kind="loading" title="Memeriksa syarat selesai…" />;
  if (q.error) return <StateView kind="error" title="Pratinjau tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} />;
  const pv = q.data;
  if (!pv || pv.kind !== "HANDOFF_GUDANG") return null;
  return (
    <Card style={{ gap: 8 }}>
      <T.Headline>Ringkasan sebelum diselesaikan</T.Headline>
      {pv.checks.map((c) => {
        const tone = c.ok ? TONE.green : TONE.red;
        const Ikon = c.status === "TIDAK_BERLAKU" ? Ban : c.ok ? CheckCircle2 : CircleAlert;
        return (
          <View key={c.key} style={{ flexDirection: "row", gap: 8, backgroundColor: tone.tint, borderRadius: 10, padding: 10 }}>
            <Ikon color={tone.text} size={17} />
            <Text style={{ flex: 1, fontFamily: F.regular, fontSize: 14, color: tone.text }}>
              <Text style={{ fontFamily: F.bold }}>{c.label}: </Text>{c.detail}{c.policy ? ` (kebijakan: ${c.policy})` : ""}
            </Text>
          </View>
        );
      })}
      {pv.expectedReturns.length ? (
        <View style={{ backgroundColor: TONE.orange.tint, borderRadius: 10, padding: 10, gap: 2 }}>
          <T.Sub style={{ color: TONE.orange.text, fontFamily: F.bold }}>Sisa bahan dikembalikan ke Gudang</T.Sub>
          {pv.expectedReturns.map((x) => <T.Sub key={x.code || x.name} style={{ color: TONE.orange.text }}>• {x.name || x.code} — {x.qty} {x.unit ?? ""}</T.Sub>)}
          <T.Caption style={{ color: TONE.orange.text }}>Barang jadi baru bisa diterima Gudang setelah sisa ini diterima.</T.Caption>
        </View>
      ) : null}
      {pv.blockers.map((b) => <T.Sub key={b.code} style={{ color: TONE.red.text }}>• {b.text}</T.Sub>)}
      <T.Caption>{pv.statement}</T.Caption>
    </Card>
  );
}
