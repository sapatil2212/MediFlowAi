// ─────────────────────────────────────────────────────────────────────────────
// TemplateDetails.tsx — full read view of one template.
//
// Shows all stored fields + the Meta id / status / category / quality, the
// rejection detail (when present), the authored components, the variable
// mappings, revisions and the per-template activity trail. Loads the row via
// waTemplateDetails and revisions via waTemplateRevisions; activity is rendered
// through the shared ActivityHistory. A preview of the current draft is shown.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { waTemplateDetailsServerFn, waTemplateRevisionsServerFn } from "../../../lib/admin";
import type { TemplateRow } from "../../../lib/wa-template-repo";
import { rowToDraftModel } from "./rowToDraft";
import { StatusBadge } from "./StatusBadge";
import { WhatsAppPreview } from "./WhatsAppPreview";
import { ActivityHistory } from "./ActivityHistory";
import { MetaErrorBox } from "./shared";

interface RevisionRow {
  id: string;
  revisionNo: number;
  metaStatusAtSnapshot: string | null;
  createdAt: string;
}

export function TemplateDetails({ templateId }: { templateId: string }) {
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<TemplateRow | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detRes, revRes] = await Promise.all([
        waTemplateDetailsServerFn({ data: { id: templateId } }) as Promise<{
          ok: boolean;
          row?: TemplateRow;
          error?: string;
        }>,
        waTemplateRevisionsServerFn({ data: { id: templateId } }) as Promise<{
          ok: boolean;
          rows?: RevisionRow[];
        }>,
      ]);
      if (detRes.ok && detRes.row) setRow(detRes.row);
      else toast.error(detRes.error || "Could not load the template.");
      if (revRes.ok && revRes.rows) setRevisions(revRes.rows);
    } catch (e: any) {
      toast.error(e?.message || "Could not load the template.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading template…
      </div>
    );
  }

  if (!row) {
    return <p className="py-6 text-sm text-zinc-400">Template not found.</p>;
  }

  const mappings = Object.entries(row.variableMappings || {});

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" data-testid="template-details">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-800">{row.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={row.metaStatus} />
            <span className="text-xs text-zinc-500">{row.language}</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Detail label="Source" value={row.source} />
          <Detail label="Category (Meta)" value={row.metaCategory || row.category} />
          <Detail label="Meta template id" value={row.metaTemplateId || "—"} />
          <Detail label="Quality" value={row.qualityScore || "—"} />
          <Detail label="Local state" value={row.localState || "—"} />
          <Detail label="Op state" value={row.opState || "—"} />
          <Detail label="Parameter format" value={row.parameterFormat} />
          <Detail label="Header type" value={row.headerType || "NONE"} />
        </dl>

        {row.rejectionReason && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-semibold">Rejected: {row.rejectionReason}</div>
            {row.rejectionDetail && <p className="text-xs">{row.rejectionDetail}</p>}
          </div>
        )}

        {(row.opState === "UNCERTAIN" || row.metaStatus === "REJECTED") && (
          <MetaErrorBox rawMessage={row.rejectionDetail} />
        )}

        <section>
          <h4 className="mb-1 text-sm font-semibold text-zinc-700">Components</h4>
          <div className="space-y-1 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-700">
            {row.headerType === "TEXT" && row.headerText && (
              <p>
                <span className="font-semibold">Header:</span> {row.headerText}
              </p>
            )}
            <p>
              <span className="font-semibold">Body:</span> {row.bodyText}
            </p>
            {row.footerText && (
              <p>
                <span className="font-semibold">Footer:</span> {row.footerText}
              </p>
            )}
            {(row.buttons || []).length > 0 && (
              <p>
                <span className="font-semibold">Buttons:</span>{" "}
                {(row.buttons || []).map((b) => b.text).join(", ")}
              </p>
            )}
          </div>
        </section>

        <section>
          <h4 className="mb-1 text-sm font-semibold text-zinc-700">Variable mappings</h4>
          {mappings.length === 0 ? (
            <p className="text-sm text-zinc-400">No variables.</p>
          ) : (
            <ul className="space-y-0.5 text-sm text-zinc-700">
              {mappings.map(([k, v]) => (
                <li key={k}>
                  <code className="rounded bg-zinc-100 px-1">{k}</code> → {v}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-1 text-sm font-semibold text-zinc-700">Revisions</h4>
          {revisions.length === 0 ? (
            <p className="text-sm text-zinc-400">No revisions.</p>
          ) : (
            <ul className="space-y-0.5 text-sm text-zinc-600">
              {revisions.map((rv) => (
                <li key={rv.id}>
                  #{rv.revisionNo} — {rv.metaStatusAtSnapshot || "draft"} (
                  {new Date(rv.createdAt).toLocaleDateString()})
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <WhatsAppPreview draft={rowToDraftModel(row)} />
        <ActivityHistory templateId={templateId} />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-zinc-800">{value}</dd>
    </>
  );
}

export default TemplateDetails;
