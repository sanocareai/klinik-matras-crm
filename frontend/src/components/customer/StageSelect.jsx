import React from "react";
// Konsolidasi 24 Agustus 2026 (restrukturisasi pipeline 7→4): daftar stage
// SEBELUMNYA hardcode lokal di sini (duplikat dari format.js) — sekarang
// diambil dari PIPELINE_STAGES supaya cuma ada SATU sumber kebenaran untuk
// daftar+label stage. STAGE_ACTIVE_CLASS (kelas CSS warna aktif) tetap lokal
// karena itu detail visual komponen ini, bukan sesuatu yang dipakai file lain.
import { PIPELINE_STAGES } from "../../utils/format.js";

const STAGE_ACTIVE_CLASS = {
  NEW:         "active-new",
  PROSPECT:    "active-prospect",
  TRANSACTION: "active-transaction",
  SPAM:        "active-spam",
};

export default function StageSelect({ value, onChange }) {
  return (
    <div className="stage-btns">
      {PIPELINE_STAGES.map(({ value: s, label }) => (
        <button
          key={s}
          type="button"
          className={`stage-btn ${value === s ? STAGE_ACTIVE_CLASS[s] : ""}`}
          onClick={() => onChange(s)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
