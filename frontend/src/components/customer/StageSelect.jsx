import React from "react";
import { STAGE_LABELS } from "../../utils/format.js";

const STAGES = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "REVIEWED"];

const STAGE_ACTIVE_CLASS = {
  NEW:       "active-new",
  QUALIFIED: "active-qualified",
  QUOTED:    "active-quoted",
  BOOKED:    "active-booked",
  SCHEDULED: "active-scheduled",
  COMPLETED: "active-completed",
  REVIEWED:  "active-reviewed",
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
