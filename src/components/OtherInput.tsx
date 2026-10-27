import { useEffect, useId, useRef, useState } from "react";
import { SendIcon } from "./Icons";

interface Props {
  onSubmit: (text: string) => void;
  placeholder?: string;
  /** Accessible name for the box */
  label?: string;
  /** Feedback shown under the box after a submit (e.g. "Added cycling") */
  hint?: string | null;
  /** Starting text, e.g. the answer being edited; focuses the box */
  initial?: string;
}

/**
 * The "Other" option: a blank text box that sits below every set of choices,
 * so the user can always type instead of tapping.
 */
export function OtherInput({ onSubmit, placeholder = "Other: type your own answer", label = "Other answer", hint, initial }: Props) {
  const id = useId();
  const [text, setText] = useState(initial ?? "");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initial) box.current?.focus();
  }, [initial]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
    setText("");
  };
  return (
    <div className="other-input">
      <form onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor={id}>{label}</label>
        <input id={id} ref={box} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button type="submit" aria-label="Send" disabled={!text.trim()}><SendIcon /></button>
      </form>
      {hint && <p className="xs other-hint" role="status">{hint}</p>}
    </div>
  );
}
