"use client";

import { useRef } from "react";
import { ruleAction } from "./actions";

const OPTIONS = [
  ["none", "No rule"],
  ["override_on", "Override: on"],
  ["override_off", "Override: off"],
  ["lock_on", "Lock: on"],
  ["lock_off", "Lock: off"],
] as const;

/** Saves as soon as the choice changes. */
export default function RuleSelect({ id, toggleId, current }: { id: string; toggleId: string; current: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={ruleAction.bind(null, id, toggleId)}>
      <select
        name="rule"
        aria-label={`Rule for ${toggleId}`}
        className="input min-h-0 py-1.5 text-sm"
        defaultValue={current}
        onChange={() => form.current?.requestSubmit()}
      >
        {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </form>
  );
}
