// ─────────────────────────────────────────────────────────────────────────────
// TemplateEditor.tsx — author a local UTILITY draft (R-BLD / R-CMP / R-VAR).
//
// Basic details (name, language, parameter format) + component builder (TEXT
// header, body, footer, buttons) + per-placeholder variable mapping and sample
// inputs. Media/location header options (IMAGE/VIDEO/DOCUMENT/LOCATION) are
// shown DISABLED with the Resumable-Upload reason (DP-02). Inline validation
// comes from the shared model (same messages client + server). A live
// WhatsAppPreview and the SubmitReviewDialog are wired in.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import {
  TEMPLATE_LANGUAGES,
  VARIABLE_CATALOGUE,
  collectPlaceholderKeys,
  validateDraft,
  type CatalogueField,
  type HeaderType,
  type ParameterFormat,
  type TemplateButton,
  type TemplateDraft,
} from "../../../lib/wa-template-model";
import {
  waCreateDraftServerFn,
  waUpdateDraftServerFn,
  waValidateDraftServerFn,
  waSubmitTemplateServerFn,
} from "../../../lib/admin";
import { WhatsAppPreview } from "./WhatsAppPreview";
import { SubmitReviewDialog } from "./SubmitReviewDialog";
import { Field, DisabledReason } from "./shared";

const MEDIA_HEADER_REASON =
  "Media and location headers need Meta's Resumable Upload flow (App ID, user token) and " +
  "per-message media, which BookMyTime does not support yet.";

export interface EditorInitial {
  id?: string;
  draft: TemplateDraft;
  notifyKind?: string | null;
}

const EMPTY_DRAFT: TemplateDraft = {
  name: "",
  language: "en_US",
  category: "UTILITY",
  parameterFormat: "POSITIONAL",
  headerType: "NONE",
  headerText: "",
  bodyText: "",
  footerText: "",
  buttons: [],
  sampleValues: {},
  variableMappings: {},
};

export function TemplateEditor({
  initial,
  onSaved,
}: {
  initial?: EditorInitial;
  onSaved?: (id: string) => void;
}) {
  const [id, setId] = useState<string | undefined>(initial?.id);
  const [draft, setDraft] = useState<TemplateDraft>(initial?.draft ?? EMPTY_DRAFT);
  const [notifyKind] = useState<string | null>(initial?.notifyKind ?? null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPayload, setReviewPayload] = useState<unknown>(null);
  const [reviewWarnings, setReviewWarnings] = useState<string[]>([]);
  const [submittedStatus, setSubmittedStatus] = useState<string | null>(null);

  const patch = (p: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...p }));

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const placeholderKeys = useMemo(() => collectPlaceholderKeys(draft), [draft]);

  const setButton = (idx: number, p: Partial<TemplateButton>) =>
    setDraft((d) => {
      const buttons = d.buttons.map((b, i) => (i === idx ? { ...b, ...p } : b));
      return { ...d, buttons };
    });

  const addButton = () => patch({ buttons: [...draft.buttons, { type: "QUICK_REPLY", text: "" }] });

  const removeButton = (idx: number) =>
    patch({ buttons: draft.buttons.filter((_, i) => i !== idx) });

  const save = async (): Promise<string | null> => {
    setSaving(true);
    try {
      const payload = { ...draft, id, notifyKind };
      const fn = id ? waUpdateDraftServerFn : waCreateDraftServerFn;
      const res = (await fn({ data: payload as any })) as {
        ok: boolean;
        id?: string;
        error?: string;
        fieldErrors?: string[];
      };
      if (res.ok && res.id) {
        setId(res.id);
        toast.success("Draft saved.");
        onSaved?.(res.id);
        return res.id;
      }
      toast.error(res.fieldErrors?.join(" ") || res.error || "Could not save the draft.");
      return null;
    } catch (e: any) {
      toast.error(e?.message || "Could not save the draft.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const openReview = async () => {
    if (!validation.ok) {
      toast.error("Fix the validation errors before submitting.");
      return;
    }
    const res = (await waValidateDraftServerFn({
      data: { ...draft, id, notifyKind } as any,
    })) as { ok: boolean; payload?: unknown; warnings?: string[]; error?: string };
    if (!res.ok) {
      toast.error(res.error || "Could not build the payload.");
      return;
    }
    setReviewPayload(res.payload ?? null);
    setReviewWarnings(res.warnings ?? []);
    setSubmittedStatus(null);
    setReviewOpen(true);
  };

  const confirmSubmit = async () => {
    setSubmitting(true);
    try {
      const savedId = id ?? (await save());
      if (!savedId) return;
      const res = (await waSubmitTemplateServerFn({ data: { id: savedId } })) as {
        ok: boolean;
        metaStatus?: string;
        error?: string;
        fieldErrors?: string[];
      };
      if (res.ok) {
        setSubmittedStatus(res.metaStatus || "PENDING");
        toast.success("Submitted to Meta for review.");
        onSaved?.(savedId);
      } else {
        toast.error(res.fieldErrors?.join(" ") || res.error || "Submission failed.");
        setReviewOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Template name" htmlFor="tpl-name">
            <input
              id="tpl-name"
              className="input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Language" htmlFor="tpl-lang">
            <select
              id="tpl-lang"
              className="input"
              value={draft.language}
              onChange={(e) => patch({ language: e.target.value })}
            >
              {TEMPLATE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parameter format" htmlFor="tpl-format">
            <select
              id="tpl-format"
              className="input"
              value={draft.parameterFormat}
              onChange={(e) => patch({ parameterFormat: e.target.value as ParameterFormat })}
            >
              <option value="POSITIONAL">Positional ({`{{1}}`})</option>
              <option value="NAMED">Named ({`{{name}}`})</option>
            </select>
          </Field>
          <Field label="Category">
            <input className="input" value="UTILITY" readOnly aria-readonly="true" />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-zinc-600">Header</legend>
          <div className="flex flex-wrap gap-2">
            {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"] as HeaderType[]).map(
              (h) => {
                const media = h !== "NONE" && h !== "TEXT";
                return (
                  <label
                    key={h}
                    className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${
                      media ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                    } ${draft.headerType === h ? "border-[#0059C6] text-[#0059C6]" : "border-zinc-300 text-zinc-600"}`}
                  >
                    <input
                      type="radio"
                      name="headerType"
                      value={h}
                      disabled={media}
                      checked={draft.headerType === h}
                      onChange={() => patch({ headerType: h })}
                    />
                    {h}
                  </label>
                );
              },
            )}
          </div>
          <DisabledReason reason={MEDIA_HEADER_REASON} />
          {draft.headerType === "TEXT" && (
            <Field label="Header text" htmlFor="tpl-header-text">
              <input
                id="tpl-header-text"
                className="input"
                value={draft.headerText ?? ""}
                onChange={(e) => patch({ headerText: e.target.value })}
              />
            </Field>
          )}
        </fieldset>

        <Field label="Body" htmlFor="tpl-body">
          <textarea
            id="tpl-body"
            className="input min-h-[120px]"
            value={draft.bodyText}
            onChange={(e) => patch({ bodyText: e.target.value })}
          />
        </Field>

        <Field label="Footer (optional)" htmlFor="tpl-footer">
          <input
            id="tpl-footer"
            className="input"
            value={draft.footerText ?? ""}
            onChange={(e) => patch({ footerText: e.target.value })}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-zinc-600">Buttons</legend>
          {draft.buttons.map((b, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Button ${idx + 1} type`}
                className="input max-w-[9rem]"
                value={b.type}
                onChange={(e) => setButton(idx, { type: e.target.value as TemplateButton["type"] })}
              >
                <option value="QUICK_REPLY">Quick reply</option>
                <option value="URL">URL</option>
                <option value="PHONE_NUMBER">Phone</option>
              </select>
              <input
                aria-label={`Button ${idx + 1} label`}
                className="input max-w-[12rem]"
                placeholder="Label"
                value={b.text}
                onChange={(e) => setButton(idx, { text: e.target.value })}
              />
              {b.type === "URL" && (
                <input
                  aria-label={`Button ${idx + 1} URL`}
                  className="input flex-1"
                  placeholder="https://…"
                  value={b.url ?? ""}
                  onChange={(e) => setButton(idx, { url: e.target.value })}
                />
              )}
              {b.type === "PHONE_NUMBER" && (
                <input
                  aria-label={`Button ${idx + 1} phone`}
                  className="input max-w-[12rem]"
                  placeholder="+1…"
                  value={b.phoneNumber ?? ""}
                  onChange={(e) => setButton(idx, { phoneNumber: e.target.value })}
                />
              )}
              <button
                type="button"
                onClick={() => removeButton(idx)}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-600 cursor-pointer"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addButton}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 cursor-pointer"
          >
            Add button
          </button>
        </fieldset>

        {placeholderKeys.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-zinc-600">
              Variables — map and sample each
            </legend>
            {placeholderKeys.map((key) => (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-zinc-100 px-2 py-1 text-xs">{key}</code>
                <select
                  aria-label={`Field for ${key}`}
                  className="input max-w-[12rem]"
                  value={draft.variableMappings[key] ?? ""}
                  onChange={(e) =>
                    patch({
                      variableMappings: {
                        ...draft.variableMappings,
                        [key]: e.target.value as CatalogueField,
                      },
                    })
                  }
                >
                  <option value="">— Map to field —</option>
                  {VARIABLE_CATALOGUE.map((c) => (
                    <option key={c.field} value={c.field}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Sample for ${key}`}
                  className="input max-w-[12rem]"
                  placeholder="Sample value"
                  value={draft.sampleValues[key] ?? ""}
                  onChange={(e) =>
                    patch({ sampleValues: { ...draft.sampleValues, [key]: e.target.value } })
                  }
                />
              </div>
            ))}
          </fieldset>
        )}

        {!validation.ok && (
          <ul
            className="list-disc space-y-0.5 rounded-lg border border-red-200 bg-red-50 p-3 pl-7 text-xs text-red-700"
            data-testid="editor-errors"
          >
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {validation.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-7 text-xs text-amber-700">
            {validation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void openReview()}
            disabled={!validation.ok}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
          >
            <Send className="h-4 w-4" /> Submit to Meta
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <WhatsAppPreview draft={draft} />
      </div>

      <SubmitReviewDialog
        open={reviewOpen}
        payload={reviewPayload}
        warnings={reviewWarnings}
        submitting={submitting}
        submittedStatus={submittedStatus}
        onConfirm={() => void confirmSubmit()}
        onClose={() => setReviewOpen(false)}
      />
    </div>
  );
}

export default TemplateEditor;
