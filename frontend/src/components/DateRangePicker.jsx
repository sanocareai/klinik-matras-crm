import React, { useState } from "react";
import { getDatePreset } from "../utils/format.js";

const PRESETS = [
  { key: "today", label: "Hari Ini" },
  { key: "7d",    label: "7 Hari" },
  { key: "30d",   label: "30 Hari" },
  { key: "3m",    label: "3 Bulan" },
];

// Props: value: {from, to}, onChange: ({from, to}) => void
export default function DateRangePicker({ value, onChange }) {
  const [customMode, setCustomMode] = useState(false);

  function handlePreset(key) {
    setCustomMode(false);
    onChange(getDatePreset(key));
  }

  function handleCustom() {
    setCustomMode(true);
    onChange({ from: "", to: "" });
  }

  function isActive(key) {
    if (customMode) return false;
    const preset = getDatePreset(key);
    return preset.from === value?.from && preset.to === value?.to;
  }

  return (
    <div className="date-range-picker">
      {PRESETS.map(({ key, label }) => (
        <button
          key={key}
          className={`drp-btn ${isActive(key) ? "active" : ""}`}
          onClick={() => handlePreset(key)}
        >
          {label}
        </button>
      ))}
      <button
        className={`drp-btn ${customMode ? "active" : ""}`}
        onClick={handleCustom}
      >
        Custom
      </button>
      {customMode && (
        <div className="drp-custom">
          <input
            type="date"
            value={value?.from || ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span>–</span>
          <input
            type="date"
            value={value?.to || ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
