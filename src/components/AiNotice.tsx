/** Shown at the top of every conversation with the agent (Today and Chat). */
export function AiNotice() {
  return (
    <p className="ai-notice" role="note">
      <span className="ai-badge" aria-hidden>AI</span>
      <span>This agent is a machine learning model and may make mistakes. It isn't medical advice; check anything important with your clinician.</span>
    </p>
  );
}
