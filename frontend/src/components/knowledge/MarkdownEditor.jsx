import { useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { Search, Save } from "lucide-react";

export default function MarkdownEditor({ value, onChange, onSave, isAdmin, saving, hasChanges }) {
  const editorViewRef = useRef(null);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
        background: "#f8fafc", borderBottom: "1px solid var(--border)",
      }}>
        <button
          onClick={() => {
            if (editorViewRef.current) {
              openSearchPanel(editorViewRef.current);
              editorViewRef.current.focus();
            }
          }}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 10px", fontSize: 12, background: "none",
            border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
            color: "var(--text-primary)",
          }}
        >
          <Search size={12} /> Cari (Ctrl+F)
        </button>
        {isAdmin && (
          <button
            onClick={onSave}
            disabled={saving || !hasChanges}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 12px", fontSize: 12,
              background: hasChanges ? "var(--primary)" : "#e5e7eb",
              color: hasChanges ? "#fff" : "var(--text-muted)",
              border: "none", borderRadius: 6,
              cursor: hasChanges && !saving ? "pointer" : "default",
              marginLeft: "auto", transition: "background 0.15s",
            }}
          >
            <Save size={12} />
            {saving ? "Menyimpan..." : hasChanges ? "Simpan Perubahan" : "Tersimpan"}
          </button>
        )}
      </div>

      <CodeMirror
        value={value}
        height="560px"
        editable={!!isAdmin}
        extensions={[
          markdown(),
          search({ top: true }),
          keymap.of(searchKeymap),
        ]}
        onChange={onChange}
        theme="dark"
        onCreateEditor={(view) => { editorViewRef.current = view; }}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          syntaxHighlighting: true,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: false,
          searchKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
        }}
      />
    </div>
  );
}
