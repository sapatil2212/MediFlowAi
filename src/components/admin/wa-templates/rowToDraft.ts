// ─────────────────────────────────────────────────────────────────────────────
// rowToDraft.ts — client-safe conversion of a stored TemplateRow into the pure
// TemplateDraft the model (preview / validation) expects.
//
// The server has its own rowToDraft in wa-templates.ts, but that module pulls
// in db/graph imports and cannot be loaded in the browser bundle. This mirror
// uses only the shared model types (import type only).
// ─────────────────────────────────────────────────────────────────────────────
import type { TemplateDraft } from "../../../lib/wa-template-model";
import type { TemplateRow } from "../../../lib/wa-template-repo";

export function rowToDraftModel(row: TemplateRow): TemplateDraft {
  return {
    name: row.name,
    language: row.language,
    category: "UTILITY",
    parameterFormat: row.parameterFormat,
    headerType: (row.headerType as TemplateDraft["headerType"]) ?? "NONE",
    headerText: row.headerText,
    bodyText: row.bodyText,
    footerText: row.footerText,
    buttons: row.buttons ?? [],
    sampleValues: row.sampleValues ?? {},
    variableMappings: row.variableMappings ?? {},
  };
}
