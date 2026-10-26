// ─────────────────────────────────────────────────────────────────────────────
// TemplatesModule.tsx — the Utility Template Management module host.
//
// Hosts the ten internal views via panel state only — NO new routes, no new
// top-level navigation (R-NAV-01/03). An in-panel view bar switches between
// Dashboard, Templates (list), Editor, Account Health, Mappings, Sync and
// Activity; opening a row from the list switches to the Details view, and
// editing / cloning opens the Editor with the row pre-loaded.
//
// Every view is wired to the FEAT-002 admin-gated server fns (imported by the
// child views). The module keeps light-theme styling consistent with
// WaCloudAdminPanel.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { toast } from "sonner";
import {
  waCloneTemplateServerFn,
  waSubmitTemplateServerFn,
  waArchiveDraftServerFn,
  waDeleteDraftServerFn,
  waDeleteMetaTemplateServerFn,
  waReconcileTemplateServerFn,
} from "../../../lib/admin";
import type { TemplateAction } from "../../../lib/wa-template-model";
import type { TemplateRow } from "../../../lib/wa-template-repo";
import { TemplateDashboard } from "./TemplateDashboard";
import { TemplateList } from "./TemplateList";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateDetails } from "./TemplateDetails";
import { AccountHealthPanel } from "./AccountHealthPanel";
import { NotificationMappings } from "./NotificationMappings";
import { ActivityHistory } from "./ActivityHistory";
import { SyncRuns } from "./SyncRuns";
import { rowToDraftModel } from "./rowToDraft";
import { ConfirmDialog } from "./shared";

type View =
  | "dashboard"
  | "list"
  | "editor"
  | "details"
  | "health"
  | "mappings"
  | "sync"
  | "activity";

const VIEW_TABS: [View, string][] = [
  ["dashboard", "Dashboard"],
  ["list", "Templates"],
  ["editor", "New template"],
  ["mappings", "Mappings"],
  ["health", "Account health"],
  ["sync", "Sync"],
  ["activity", "Activity"],
];

interface EditorState {
  id?: string;
  row?: TemplateRow;
}

interface PendingAction {
  action: TemplateAction;
  row: TemplateRow;
}

const CONFIRMABLE: Record<string, { title: string; description: string; destructive?: boolean }> = {
  submit: {
    title: "Submit to Meta?",
    description:
      "The template is sent to Meta for review and becomes PENDING. This cannot be undone.",
  },
  archive: {
    title: "Archive this draft?",
    description: "The draft is archived and hidden from the active list.",
  },
  deleteDraft: {
    title: "Delete this draft?",
    description: "The never-submitted draft is permanently removed.",
    destructive: true,
  },
  deleteMeta: {
    title: "Delete from Meta?",
    description:
      "The template is deleted from Meta (this language only). Approved names are blocked for 30 days.",
    destructive: true,
  },
  reconcile: {
    title: "Check with Meta?",
    description: "Lists Meta templates to reconcile an uncertain submission by name and language.",
  },
};

export function TemplatesModule() {
  const [view, setView] = useState<View>("dashboard");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [listKey, setListKey] = useState(0);

  const openDetails = (row: TemplateRow) => {
    setDetailsId(row.id);
    setView("details");
  };

  const runAction = async ({ action, row }: PendingAction) => {
    try {
      if (action === "edit" || action === "clone") {
        if (action === "clone") {
          const res = (await waCloneTemplateServerFn({ data: { id: row.id } })) as {
            ok: boolean;
            id?: string;
            error?: string;
          };
          if (!res.ok) {
            toast.error(res.error || "Could not clone.");
            return;
          }
          toast.success("Template cloned.");
          setEditor({ id: res.id, row });
        } else {
          setEditor({ id: row.id, row });
        }
        setView("editor");
        return;
      }
      let res: { ok: boolean; error?: string } = { ok: false };
      if (action === "submit")
        res = (await waSubmitTemplateServerFn({ data: { id: row.id } })) as any;
      else if (action === "archive")
        res = (await waArchiveDraftServerFn({ data: { id: row.id } })) as any;
      else if (action === "deleteDraft")
        res = (await waDeleteDraftServerFn({ data: { id: row.id } })) as any;
      else if (action === "deleteMeta")
        res = (await waDeleteMetaTemplateServerFn({ data: { id: row.id } })) as any;
      else if (action === "reconcile")
        res = (await waReconcileTemplateServerFn({ data: { id: row.id } })) as any;
      if (res.ok) {
        toast.success("Done.");
        setListKey((k) => k + 1);
      } else {
        toast.error(res.error || "Action failed.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Action failed.");
    }
  };

  const handleAction = (action: TemplateAction, row: TemplateRow) => {
    if (action === "edit" || action === "clone") {
      void runAction({ action, row });
      return;
    }
    setPending({ action, row });
  };

  const confirmInfo = pending ? CONFIRMABLE[pending.action] : null;

  return (
    <div className="space-y-5" data-testid="templates-module">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200">
        {VIEW_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === "editor") setEditor(null);
              setView(id);
            }}
            className={`px-3 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              view === id
                ? "border-[#0059C6] text-[#0059C6]"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "dashboard" && <TemplateDashboard />}
      {view === "list" && (
        <TemplateList key={listKey} onOpen={openDetails} onAction={handleAction} />
      )}
      {view === "editor" && (
        <TemplateEditor
          initial={
            editor?.row
              ? {
                  id: editor.id,
                  draft: rowToDraftModel(editor.row),
                  notifyKind: editor.row.notifyKind,
                }
              : undefined
          }
          onSaved={() => setListKey((k) => k + 1)}
        />
      )}
      {view === "details" && detailsId && <TemplateDetails templateId={detailsId} />}
      {view === "health" && <AccountHealthPanel />}
      {view === "mappings" && <NotificationMappings />}
      {view === "sync" && <SyncRuns />}
      {view === "activity" && <ActivityHistory templateId={null} />}

      <ConfirmDialog
        open={!!pending}
        title={confirmInfo?.title ?? ""}
        description={confirmInfo?.description}
        destructive={confirmInfo?.destructive}
        confirmLabel={confirmInfo?.destructive ? "Delete" : "Confirm"}
        onConfirm={() => {
          if (pending) void runAction(pending);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />

      <ModuleStyle />
    </div>
  );
}

function ModuleStyle() {
  return (
    <style>{`
      .input {
        width: 100%;
        border: 1px solid #d4d4d8;
        border-radius: 0.5rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        outline: none;
      }
      .input:focus { border-color: #0059C6; box-shadow: 0 0 0 2px rgba(0,89,198,0.15); }
    `}</style>
  );
}

export default TemplatesModule;
