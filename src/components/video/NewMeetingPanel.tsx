// ─────────────────────────────────────────────────────────────────────────────
// NewMeetingPanel.tsx — Google-Meet-style meeting creation.
//
// Three entry points, mirroring Meet's "New meeting" menu:
//   • Start an instant meeting        → room opens now, host joins immediately
//   • Create a meeting link for later → link to copy/share, waiting room on
//   • Schedule for a date and time    → link delivered to the patient up front
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import {
  Video,
  Link2,
  CalendarClock,
  Loader2,
  Copy,
  Check,
  ChevronLeft,
  Send,
  X,
} from "lucide-react";
import { createInstantMeetingServerFn } from "../../lib/video";
import { cn } from "../../lib/utils";

type Mode = "menu" | "later" | "schedule";

interface NewMeetingPanelProps {
  /** Host joins immediately; joinLink is the shareable patient URL. */
  onStartCall: (roomId: string, joinLink: string, meta?: { meetingCode?: string }) => void;
  onCreated?: () => void;
}

export function NewMeetingPanel({ onStartCall, onCreated }: NewMeetingPanelProps) {
  const [mode, setMode] = useState<Mode>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ roomId: string; joinLink: string; meetingCode: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Shared form state (Get a link / Schedule)
  const [title, setTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const reset = () => {
    setMode("menu");
    setCreated(null);
    setError(null);
    setTitle("");
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setDate("");
    setTime("");
  };

  const create = useCallback(
    async (opts: { scheduledAt?: string | null; autoAdmit: boolean; startNow: boolean; notify: boolean }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await createInstantMeetingServerFn({
          data: {
            title: title.trim() || undefined,
            scheduledAt: opts.scheduledAt ?? null,
            guestName: guestName.trim() || undefined,
            guestPhone: guestPhone.trim() || undefined,
            guestEmail: guestEmail.trim() || undefined,
            autoAdmit: opts.autoAdmit,
            notify: opts.notify,
          },
        });
        onCreated?.();
        if (opts.startNow) {
          onStartCall(res.roomId, res.joinLink, { meetingCode: res.meetingCode });
          reset();
        } else {
          setCreated({ roomId: res.roomId, joinLink: res.joinLink, meetingCode: res.meetingCode });
        }
      } catch (e: any) {
        setError(e?.message ?? "Could not create the meeting.");
      } finally {
        setBusy(false);
      }
    },
    [title, guestName, guestPhone, guestEmail, onStartCall, onCreated],
  );

  /** Google Meet style: one click → unique room + join immediately with shareable URL. */
  const startInstantNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createInstantMeetingServerFn({
        data: {
          autoAdmit: true,
          notify: false,
          scheduledAt: null,
        },
      });
      onCreated?.();
      onStartCall(res.roomId, res.joinLink, { meetingCode: res.meetingCode });
      reset();
    } catch (e: any) {
      setError(e?.message ?? "Could not start the meeting.");
    } finally {
      setBusy(false);
    }
  }, [onStartCall, onCreated]);

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.joinLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  // ── Created confirmation ─────────────────────────────────────────────────
  if (created) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Meeting ready</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Share this link with your patient. Anyone with the link can join from any network.
            </p>
          </div>
          <button onClick={reset} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-zinc-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Meeting code</p>
          <p className="font-mono text-sm font-semibold text-zinc-800">{created.meetingCode}</p>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 p-2">
          <code className="min-w-0 flex-1 truncate text-xs text-zinc-600">{created.joinLink}</code>
          <button
            onClick={copy}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => onStartCall(created.roomId, created.joinLink, { meetingCode: created.meetingCode })}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Video className="h-4 w-4" /> Join now
          </button>
          <button
            onClick={reset}
            className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Menu ─────────────────────────────────────────────────────────────────
  if (mode === "menu") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h3 className="text-sm font-bold text-zinc-900">New consultation</h3>
        <p className="mt-0.5 text-xs text-zinc-500">Start a call now, or share a link for later.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button
            onClick={() => void startInstantNow()}
            disabled={busy}
            className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-left transition hover:bg-blue-50 disabled:opacity-60"
          >
            <span className="inline-flex text-blue-600">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Video className="h-5 w-5" />}
            </span>
            <p className="mt-2 text-sm font-bold text-zinc-900">Start now</p>
            <p className="text-xs text-zinc-500">Instant meeting with a shareable link</p>
          </button>
          <MenuCard
            icon={<Link2 className="h-5 w-5" />}
            title="Get a link"
            detail="Copy and share it yourself"
            onClick={() => setMode("later")}
          />
          <MenuCard
            icon={<CalendarClock className="h-5 w-5" />}
            title="Schedule"
            detail="Pick a date and notify the patient"
            onClick={() => setMode("schedule")}
          />
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  // ── Forms (Get a link / Schedule) ────────────────────────────────────────
  const isSchedule = mode === "schedule";
  const canSubmit = !isSchedule || (date && time);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <button
        onClick={() => setMode("menu")}
        className="mb-3 flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-800"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Back
      </button>

      <h3 className="text-sm font-bold text-zinc-900">
        {mode === "later" ? "Create a meeting link" : "Schedule a consultation"}
      </h3>

      <div className="mt-4 space-y-3">
        <Field label="Title (optional)">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Follow-up consultation"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </Field>

        {isSchedule && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </Field>
          </div>
        )}

        <Field label="Patient name (optional)">
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Patient name"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </Field>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="WhatsApp number (optional)">
            <input
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="+91…"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </Field>
          <Field label="Email (optional)">
            <input
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="patient@example.com"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </Field>
        </div>

        {(guestPhone || guestEmail) && (
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Send className="h-3 w-3" /> The join link will be sent automatically.
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          {mode === "later" && (
            <button
              onClick={() => create({ scheduledAt: null, autoAdmit: false, startNow: false, notify: true })}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create link
            </button>
          )}
          {mode === "schedule" && (
            <button
              onClick={() => {
                const dt = new Date(`${date}T${time}`);
                create({ scheduledAt: dt.toISOString(), autoAdmit: false, startNow: false, notify: true });
              }}
              disabled={busy || !canSubmit}
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Schedule & send link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-zinc-200 p-3 text-left transition hover:bg-zinc-50"
    >
      <span className="inline-flex text-zinc-500">{icon}</span>
      <p className="mt-2 text-sm font-bold text-zinc-900">{title}</p>
      <p className="text-xs text-zinc-500">{detail}</p>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
