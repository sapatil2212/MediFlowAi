// ─────────────────────────────────────────────────────────────────────────────
// WhatsAppPreview.tsx — a light-theme WhatsApp-style bubble preview.
//
// Renders header / body / footer / buttons with the draft's sample values
// substituted and HTML-ESCAPED by buildPreviewModel() (R-PRE). No template
// evaluation, no script, no Meta call. Always labelled "Preview — not sent".
//
// buildPreviewModel() returns already-escaped strings; they are placed as plain
// text (never dangerouslySetInnerHTML), so an injected "<img onerror>" shows as
// literal text and cannot execute.
// ─────────────────────────────────────────────────────────────────────────────
import { buildPreviewModel, type TemplateDraft } from "../../../lib/wa-template-model";

export function WhatsAppPreview({ draft }: { draft: TemplateDraft }) {
  const model = buildPreviewModel(draft);
  return (
    <div className="space-y-2" data-testid="wa-preview">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Preview — not sent
      </div>
      <div className="rounded-xl bg-[#e5ddd5] p-4">
        <div className="ml-auto max-w-sm rounded-lg bg-white p-3 shadow-sm">
          {model.header && (
            <div className="mb-1 text-sm font-bold text-zinc-800" data-testid="preview-header">
              {model.header}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm text-zinc-800" data-testid="preview-body">
            {model.body}
          </div>
          {model.footer && (
            <div className="mt-1 text-xs text-zinc-400" data-testid="preview-footer">
              {model.footer}
            </div>
          )}
        </div>
        {model.buttons.length > 0 && (
          <div className="mt-2 space-y-1" data-testid="preview-buttons">
            {model.buttons.map((b, i) => (
              <div
                key={`${b.type}-${i}`}
                className="rounded-lg bg-white py-2 text-center text-sm font-medium text-[#0059C6] shadow-sm"
              >
                {b.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default WhatsAppPreview;
