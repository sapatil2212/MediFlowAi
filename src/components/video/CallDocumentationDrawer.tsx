// ─────────────────────────────────────────────────────────────────────────────
// CallDocumentationDrawer.tsx — write SOAP notes during / after a video call.
//
// Mounts the existing SOAP save path (saveSoapNoteServerFn) with appointmentId +
// patientId from the room, so validation and associations are identical to an
// in-person visit (Req 14.2, 14.5). Non-blocking: saving never touches the peer
// connection (Req 14.1). Refuses to submit without a patientId (no orphan rows).
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { X, Loader2, Save, FileText, AlertCircle } from "lucide-react";
import { saveSoapNoteServerFn } from "../../lib/auth";
import { cn } from "../../lib/utils";

interface CallDocumentationDrawerProps {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  patientId: string | null;
  patientName?: string | null;
}

export function CallDocumentationDrawer({
  open,
  onClose,
  appointmentId,
  patientId,
  patientName,
}: CallDocumentationDrawerProps) {
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!patientId) {
      setError("This appointment has no linked patient record, so notes can't be saved. Add the patient first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSoapNoteServerFn({
        data: { patientId, appointmentId, subjective, objective, assessment, plan },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Could not save the note. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[60] w-full max-w-md transform bg-white shadow-2xl transition-transform duration-300 sm:w-[26rem]",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Consultation notes</h3>
              {patientName && <p className="text-xs text-zinc-500">{patientName}</p>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!patientId && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              No patient record is linked to this appointment. Notes cannot be saved until one is added.
            </div>
          )}
          <Field label="Subjective" value={subjective} onChange={setSubjective} placeholder="Patient's narrative, chief complaint, history…" />
          <Field label="Objective" value={objective} onChange={setObjective} placeholder="Exam findings, vitals…" />
          <Field label="Assessment" value={assessment} onChange={setAssessment} placeholder="Diagnosis, clinical impression…" />
          <Field label="Plan" value={plan} onChange={setPlan} placeholder="Treatment, prescriptions, follow-up…" />
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="border-t border-zinc-200 p-4">
          <button
            onClick={save}
            disabled={saving || !patientId}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? "Saved" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}
