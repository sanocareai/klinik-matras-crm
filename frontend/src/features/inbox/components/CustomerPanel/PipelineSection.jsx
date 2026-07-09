import React, { useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { api } from "../../../../api.js";
import StageSelect from "../../../../components/customer/StageSelect.jsx";
import { STAGE_LABELS } from "../../../../utils/format.js";

const UNDO_MS = 5000;

// StageSelect (existing, dipakai juga di CustomerDrawer) murni presentational
// — cukup dikasih value+onChange, jadi bisa dipakai langsung di sini tanpa
// perlu tulis ulang pill selector-nya.
export default function PipelineSection({ customer, onUpdate }) {
  const [undoState, setUndoState] = useState(null); // { previousStage }
  const timerRef = useRef(null);

  async function commitStage(stage) {
    try {
      const updated = await api.updateCustomer(customer.id, { pipelineStage: stage });
      onUpdate((c) => ({ ...c, ...updated }));
    } catch (err) {
      alert(err.message);
    }
  }

  function handleChange(newStage) {
    const previousStage = customer.pipelineStage;
    if (newStage === previousStage) return;

    onUpdate((c) => ({ ...c, pipelineStage: newStage })); // optimistic
    commitStage(newStage);

    clearTimeout(timerRef.current);
    setUndoState({ previousStage });
    timerRef.current = setTimeout(() => setUndoState(null), UNDO_MS);
  }

  function handleUndo() {
    if (!undoState) return;
    clearTimeout(timerRef.current);
    const { previousStage } = undoState;
    setUndoState(null);
    onUpdate((c) => ({ ...c, pipelineStage: previousStage }));
    commitStage(previousStage);
  }

  return (
    <div className="panel-section">
      <span className="panel-section-label">Tahap Pipeline</span>
      <StageSelect value={customer.pipelineStage} onChange={handleChange} />

      {undoState && (
        <div className="pipeline-undo-toast">
          <span>Diubah ke {STAGE_LABELS[customer.pipelineStage] || customer.pipelineStage}</span>
          <button onClick={handleUndo}><Undo2 size={13} /> Urungkan</button>
        </div>
      )}
    </div>
  );
}
