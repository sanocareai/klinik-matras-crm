import React, { useEffect, useState } from "react";
import { api } from "@/api.js";
import { FLAG_TEXT, NOT_RECORDED, fmtQty, materialChainRows, reworkState } from "./materialChainModel.js";

// Rantai bahan (baca saja): racikan komponen (Meja/QC) → BOM rencana → diserahkan Gudang → dipakai (aktual). Empat sumber berbeda, ditautkan per bahan katalog.
// Racikan dibaca dari Catatan Komponen (satu endpoint); BOM/diserahkan/dipakai dari kartu Run. Menampilkan tidak mengubah apa pun (tanpa stok).
export default function MaterialChain({ card }) {
  const [notes, setNotes] = useState(undefined);
  useEffect(() => { let alive = true; api.getComponentNotes(card.unit.id).then((n) => { if (alive) setNotes(n); }).catch(() => { if (alive) setNotes(null); }); return () => { alive = false; }; }, [card.unit.id, card.revision]);
  const plan = notes?.sections?.PLAN_RACIKAN ?? null;
  const { rows, unlinked, hasPlan } = materialChainRows({ planEntry: plan, bom: card.bom || [], issued: card.issuedMaterials || [], used: card.materialPic?.record?.materials || (card.build?.record?.materials || []) });
  return (
    <div className="space-y-2" data-testid="material-chain">
      <p className="m-0 text-[12.5px] text-ink3">Racikan (Meja/QC) → BOM rencana → diserahkan Gudang → dipakai. Empat catatan terpisah, ditautkan per bahan.</p>
      {notes === undefined && <div className="h-10 animate-pulse rounded-btn bg-inset" />}
      {card.assembly?.applicable && (
        <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="chain-round">Putaran {card.assembly.round}{card.assembly.rounds?.length ? ` · ${card.assembly.rounds.length} putusan QC gagal sebelumnya` : ""}.
          {reworkState(card).kind === "OPEN" && <b className="text-orange"> Rework belum dimulai — bahan tambahan bisa diminta sekarang.</b>}
          {reworkState(card).kind === "REQUESTED" && <span data-testid="chain-rework-issue"> Bahan rework diminta: {reworkState(card).issue.issueNumber} ({reworkState(card).issue.status === "ISSUED" ? "sudah diserahkan Gudang" : "menunggu Gudang"}).</span>}
        </p>
      )}
      {!hasPlan && notes !== undefined && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="chain-no-plan">Racikan rencana {NOT_RECORDED.toLowerCase()} oleh PIC Meja/PIC QC.</p>}
      {rows.length === 0 && <p className="m-0 text-[13px] text-ink3" data-testid="chain-empty">BOM, bahan diserahkan, dan pemakaian {NOT_RECORDED.toLowerCase()}.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {rows.map((r) => (
          <li key={r.materialId} data-testid="chain-row" data-material-id={r.materialId} className="rounded-btn bg-inset px-3 py-2 text-[13px]">
            <p className="m-0 break-words font-bold text-ink [overflow-wrap:anywhere]">{r.name || r.code || "Bahan"}{r.code ? <span className="font-normal text-ink3"> · {r.code}</span> : null}</p>
            {(r.supplier || r.itemGroup) && <p className="m-0 text-[12px] text-ink3">{[r.supplier && `Supplier: ${r.supplier}`, r.itemGroup && `Kelompok: ${r.itemGroup}`].filter(Boolean).join(" · ")}</p>}
            <dl className="m-0 mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px] text-ink2">
              <div data-testid="chain-racikan"><dt className="inline text-ink3">Racikan: </dt><dd className="inline">{r.racikan.length ? r.racikan.map((u) => `${u.where} (${u.action === "KEEP" ? "dipertahankan" : u.action === "REPAIR" ? "diperbaiki" : "diganti"})`).join(", ") : NOT_RECORDED}</dd></div>
              <div data-testid="chain-bom"><dt className="inline text-ink3">BOM rencana: </dt><dd className="inline">{fmtQty(r.bomQty, r.unit) ?? NOT_RECORDED}</dd></div>
              <div data-testid="chain-issued"><dt className="inline text-ink3">Diserahkan: </dt><dd className="inline">{fmtQty(r.issuedQty, r.unit) ?? "Belum diserahkan"}</dd></div>
              <div data-testid="chain-remaining"><dt className="inline text-ink3">Sisa belum dipakai: </dt><dd className="inline">{r.issuedQty != null ? fmtQty(Math.max(0, Math.round((r.issuedQty - (r.usedQty || 0)) * 10000) / 10000), r.unit) : "—"}</dd></div>
              <div data-testid="chain-used"><dt className="inline text-ink3">Dipakai: </dt><dd className="inline">{fmtQty(r.usedQty, r.unit) ?? NOT_RECORDED}</dd></div>
            </dl>
            {r.flags.length > 0 && <p className="m-0 mt-1 text-[12px] text-orange" data-testid="chain-flags">{r.flags.map((f) => FLAG_TEXT[f]).join(" · ")}</p>}
          </li>
        ))}
      </ul>
      {unlinked.length > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="chain-unlinked">Racikan tanpa katalog (belum bisa masuk BOM): {unlinked.map((u) => `${u.where} — ${u.label}`).join("; ")}</p>}
    </div>
  );
}
