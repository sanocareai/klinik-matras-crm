import React from "react";
import { STAGE_LABELS } from "../../utils/format.js";

const STAGES = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];

const STAGE_ACTIVE_CLASS = {
  LEAD:      "active-lead",
  QUALIFIED: "active-qualified",
  QUOTED:    "active-quoted",
  WON:       "active-won",
  LOST:      "active-lost",
};

export default function StageSelect({ value, onChange }) {
  return (
    <div className="stage-btns">
      {STAGES.map((s) => (
        <button
          key={s}
          type="button"
          className={`stage-btn ${value === s ? STAGE_ACTIVE_CLASS[s] : ""}`}
          onClick={() => onChange(s)}
        >
          {STAGE_LABELS[s] || s}
        </button>
      ))}
    </div>
  );
}
