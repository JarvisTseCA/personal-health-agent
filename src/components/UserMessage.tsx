import { useEffect, useId, useRef, useState } from "react";
import { PencilIcon } from "./Icons";

/** "just now", "4 minutes ago", "2 hours ago", or a date. */
export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  text: string;
  at?: number;
  /** Tapped: shows the actions row under the bubble */
  selected: boolean;
  onSelect: () => void;
  /** Go back to this message's stage (Today). Leave out to hide the pencil. */
  onEdit?: () => void;
  /** Edit the text in place and resend (Coach). Leave out to hide the pencil. */
  onSave?: (text: string) => void;
  disabled?: boolean;
}

/**
 * A message the user sent. Tapping it shows when it was sent and a pencil,
 * modeled on Claude's chat: the pencil either rewinds to that question
 * (`onEdit`) or turns the bubble into an edit box with Cancel and Save (`onSave`).
 */
export function UserMessage({ text, at, selected, onSelect, onEdit, onSave, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const canEdit = !disabled && (onEdit || onSave);

  useEffect(() => {
    if (editing && box.current) {
      box.current.focus();
      box.current.setSelectionRange(box.current.value.length, box.current.value.length);
    }
  }, [editing]);

  if (editing && onSave) {
    const save = () => {
      const t = draft.trim();
      if (!t || t === text) return;
      setEditing(false);
      onSave(t);
    };
    return (
      <form className="msg-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="sr-only" htmlFor={id}>Edit your message</label>
        <textarea
          id={id}
          ref={box}
          value={draft}
          rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 32)))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
            if (e.key === "Escape") { setEditing(false); setDraft(text); }
          }}
        />
        <div className="msg-edit-actions">
          <button type="button" className="btn btn-quiet small-btn" onClick={() => { setEditing(false); setDraft(text); }}>Cancel</button>
          <button type="submit" className="btn btn-primary small-btn" disabled={!draft.trim() || draft.trim() === text}>Save</button>
        </div>
      </form>
    );
  }

  return (
    <div className="umsg">
      <button type="button" className="msg user" aria-expanded={selected} onClick={onSelect}>{text}</button>
      {selected && (
        <div className="msg-actions">
          {at && <span className="msg-time">{timeAgo(at)}</span>}
          {canEdit && (
            <button
              type="button"
              className="msg-act"
              aria-label="Edit"
              data-tip="Edit"
              onClick={() => (onSave ? (setDraft(text), setEditing(true)) : onEdit!())}
            >
              <PencilIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
