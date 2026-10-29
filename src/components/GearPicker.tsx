import { useEffect, useRef, useState } from "react";
import { SAMPLE_PHOTO_SIZE, SAMPLE_PHOTOS } from "../data/samplePhotos";
import { EQUIPMENT, equipmentName, parseEquipment, parseEquipmentFeedback, type EquipmentPlace } from "../lib/equipment";
import { CameraIcon } from "./Icons";
import { OtherInput } from "./OtherInput";

type Phase = "idle" | "uploading" | "analyzing" | "done";
interface Turn { role: "agent" | "user"; text: string }

/** "a, b and c" */
function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/**
 * Equipment for one place (home or gym) during onboarding.
 *
 * Demo flow: "Upload a photo" loads the built-in sample photo for that
 * place, the agent analyzes it (boxes drawn over what it found, then a
 * message listing it), and the user replies in a text box to correct it
 * ("no kettlebell, but I have a jump rope"). Typing a list and tapping chips
 * still work. The chips always show the current list.
 */
export function GearPicker({ place, value, onChange, onNote }: { place: EquipmentPlace; value: string[]; onChange: (ids: string[]) => void; onNote: (text: string) => void }) {
  const sample = SAMPLE_PHOTOS[place];
  const [phase, setPhase] = useState<Phase>("idle");
  const [thread, setThread] = useState<Turn[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // The latest list, for replies computed inside timers and handlers.
  const current = useRef(value);
  current.current = value;

  const items = [...EQUIPMENT.filter((e) => e.usual.includes(place)), ...EQUIPMENT.filter((e) => !e.usual.includes(place))];
  const set = (ids: string[]) => { current.current = ids; onChange(ids); };
  const toggle = (id: string) => set(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const named = (ids: string[]) => list(ids.map((id) => equipmentName(id).toLowerCase()));

  const upload = () => {
    setPhase("uploading");
    setThread([]);
    setHint(null);
    timers.current.push(window.setTimeout(() => setPhase("analyzing"), 700));
    timers.current.push(window.setTimeout(() => {
      const found = sample.detections.map((d) => d.id);
      set([...current.current, ...found.filter((id) => !current.current.includes(id))]);
      setPhase("done");
      setThread([{
        role: "agent",
        text: `Here's what I can see in your photo of ${sample.scene}: ${list(sample.detections.map((d) => d.describe))}. ` +
          `I left out ${sample.ignored}, since they aren't exercise equipment. Did I get it right? Tell me anything I missed or got wrong.`,
      }]);
    }, 2300));
  };

  const feedback = (text: string) => {
    const f = parseEquipmentFeedback(text);
    const before = current.current;
    const removed = f.remove.filter((id) => before.includes(id));
    const added = f.add.filter((id) => !before.includes(id));
    const after = [...before.filter((id) => !removed.includes(id)), ...added];
    let reply: string;
    if (removed.length || added.length) {
      set(after);
      const the = (ids: string[]) => list(ids.map((id) => `the ${equipmentName(id).toLowerCase()}`));
      const parts = [removed.length ? `taken out ${the(removed)}` : "", added.length ? `added ${the(added)}` : ""].filter(Boolean);
      reply = `Thanks, I've ${parts.join(" and ")}. ${place === "home" ? "At home" : "At your gym"} you now have: ${after.length ? named(after) : "nothing yet"}. Anything else?`;
    } else if (f.confirmed) {
      reply = `Great. I'll plan your ${place === "home" ? "home" : "gym"} workouts around these: ${named(before)}.`;
    } else if (f.add.length || f.remove.length) {
      reply = `That matches what I have: ${named(before)}. Anything else?`;
    } else {
      onNote(text);
      reply = "I couldn't match that to equipment I know, so I've saved it as a note for the team. You can also tap the list below to fix it.";
    }
    setThread((t) => [...t, { role: "user", text }, { role: "agent", text: reply }]);
  };

  const typed = (text: string) => {
    const found = parseEquipment(text);
    if (found.length) {
      set([...value, ...found.filter((id) => !value.includes(id))]);
      setHint(`Added ${named(found)}.`);
    } else {
      onNote(text);
      setHint("I didn't recognize that, so I've noted it. Tap the closest match below.");
    }
  };

  const { w, h } = SAMPLE_PHOTO_SIZE;
  return (
    <div className="gear">
      {phase === "idle" ? (
        <>
          <button className="btn btn-quiet gear-camera" onClick={upload}><CameraIcon />Upload a photo</button>
          <OtherInput placeholder={place === "home" ? "Or type it: e.g. two dumbbells and a mat" : "Or type it: e.g. treadmills, spin bikes, free weights"} onSubmit={typed} hint={hint} />
        </>
      ) : (
        <>
          <figure className={`gear-shot is-${phase}`}>
            <img src={sample.src} alt={sample.alt} width={w} height={h} />
            {phase === "analyzing" && <span className="gear-scan" aria-hidden />}
            {phase === "done" && sample.detections.filter((d) => value.includes(d.id)).map((d) => (
              <span
                key={d.id}
                className="gear-box"
                style={{ left: `${(d.box[0] / w) * 100}%`, top: `${(d.box[1] / h) * 100}%`, width: `${(d.box[2] / w) * 100}%`, height: `${(d.box[3] / h) * 100}%` }}
              >
                <em>{equipmentName(d.id)}</em>
              </span>
            ))}
            {phase !== "done" && <span className="gear-status" role="status">{phase === "uploading" ? "Uploading photo…" : "Analyzing your photo…"}</span>}
          </figure>
          {phase === "done" && <p className="xs muted gear-caption">Sample photo (demo). Boxes show what the agent found.</p>}
          {phase === "uploading" && <div className="gear-progress" aria-hidden><span /></div>}
          {thread.length > 0 && (
            <div className="gear-thread" aria-live="polite">
              {thread.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text}</div>)}
            </div>
          )}
          {phase === "done" && (
            <OtherInput
              label="Reply to the agent about its analysis"
              placeholder="Reply: e.g. no kettlebell, but I have a jump rope"
              onSubmit={feedback}
            />
          )}
        </>
      )}
      <p className="xs muted" style={{ margin: "14px 0 8px" }}>
        {value.length ? `${phase === "done" ? "Your list" : `${value.length} selected`}: ${value.map(equipmentName).join(", ")}. Tap to change.` : "Or tap what you have"}
      </p>
      <div className="chips">
        {items.map((e) => (
          <button key={e.id} className="chip" aria-pressed={value.includes(e.id)} onClick={() => toggle(e.id)}>{e.name}</button>
        ))}
      </div>
      <p className="xs muted" style={{ marginTop: 10 }}>Demo: "Upload a photo" uses a built-in sample photo, and the analysis is scripted. Nothing is uploaded.</p>
    </div>
  );
}
