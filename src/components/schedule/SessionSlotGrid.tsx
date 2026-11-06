// ─────────────────────────────────────────────────────────────────────────────
// SessionSlotGrid — available time slots grouped under Morning / Afternoon /
// Evening. Used by the public booking page and the dashboards' "new
// appointment" pickers. Takes the flat "09:00 AM" labels the slot endpoints
// already return; grouping is derived from each label's start time.
// ─────────────────────────────────────────────────────────────────────────────
import type * as React from "react";
import { Moon, Sun, Sunrise } from "lucide-react";
import { groupSlotLabels, type SessionKey } from "@/lib/day-sessions";

const ICONS: Record<SessionKey, React.ElementType> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Moon,
};

export interface SessionSlotGridProps {
  slots: readonly string[];
  selected: string;
  onSelect: (slot: string) => void;
  /** Tailwind max-height for the scroll area. */
  maxHeightClass?: string;
}

export function SessionSlotGrid({
  slots,
  selected,
  onSelect,
  maxHeightClass = "max-h-64",
}: SessionSlotGridProps) {
  const groups = groupSlotLabels(slots);
  return (
    <div className={`${maxHeightClass} overflow-y-auto pr-1 space-y-2.5`}>
      {groups.map((g) => {
        const Icon = ICONS[g.key];
        return (
          <div key={g.key} role="group" aria-label={`${g.label} slots`}>
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-zinc-600">
                <Icon className="h-3 w-3 text-brand" /> {g.label}
              </span>
              <span className="text-[8px] font-semibold text-zinc-400">
                {g.slots.length} slot{g.slots.length === 1 ? "" : "s"} · {g.range}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {g.slots.map((slot) => {
                const isSelected = selected === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(slot)}
                    className={`rounded-xl py-2 px-1 text-[10px] font-bold border transition-all cursor-pointer text-center ${
                      isSelected
                        ? "bg-black border-zinc-800 text-white font-black scale-[1.02]"
                        : "bg-white border-zinc-200 text-zinc-650 hover:border-zinc-800/40"
                    }`}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SessionSlotGrid;
