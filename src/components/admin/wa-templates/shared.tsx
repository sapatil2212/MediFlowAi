// ─────────────────────────────────────────────────────────────────────────────
// shared.tsx — small UI primitives reused across the Templates module.
//
// Field          labelled form control wrapper (matches WaCloudAdminPanel).
// DisabledReason a visible, accessible reason attached to a disabled control
//                (R-LIST-08 / R-GEN-12).
// ConfirmDialog  an alert-dialog confirmation before submit / destructive ops.
// MetaErrorBox   renders describeMetaError() output + an optional external link;
//                it NEVER shows a token/secret (§13).
// ExternalLink   an anchor that always carries target=_blank rel=noopener.
//
// Light theme only (the admin dashboard has no dark mode). Reuses the existing
// Radix-based alert-dialog primitive; no new dependency.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink as ExternalLinkIcon, Info } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { describeMetaError } from "../../../lib/wa-template-model";

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1" htmlFor={htmlFor}>
      <span className="text-xs font-semibold text-zinc-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

/**
 * A visible reason for a disabled control. Rendered inline with the control it
 * explains; `htmlFor`/`id` let the caller wire aria-describedby so the reason is
 * announced by assistive tech.
 */
export function DisabledReason({ id, reason }: { id?: string; reason: string }) {
  return (
    <span
      id={id}
      role="note"
      className="mt-1 inline-flex items-start gap-1 text-xs text-amber-700"
      data-testid="disabled-reason"
    >
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{reason}</span>
    </span>
  );
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-flex items-center gap-1 text-sm font-medium text-[#0059C6] hover:underline"
      }
    >
      {children}
      <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

/**
 * Renders a Meta error through describeMetaError(). Never shows a token/secret —
 * only the code, the stable explanation, the next action and an optional link.
 */
export function MetaErrorBox({
  code,
  subcode,
  rawMessage,
}: {
  code?: number | null;
  subcode?: number | null;
  rawMessage?: string | null;
}) {
  const info = describeMetaError(code, subcode);
  return (
    <div
      role="alert"
      className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Meta error{typeof code === "number" ? ` (${code}${subcode ? `/${subcode}` : ""})` : ""}
        </span>
      </div>
      <p>{info.explanation}</p>
      <p className="text-red-700">{info.nextAction}</p>
      {rawMessage && <p className="text-xs text-red-500">{rawMessage}</p>}
      {info.link && (
        <ExternalLink href={info.link} className="text-sm font-medium text-red-700 hover:underline">
          Open in WhatsApp Manager
        </ExternalLink>
      )}
    </div>
  );
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/**
 * A confirmation dialog shown before submit / destructive actions (§13). The
 * caller controls `open`; `onConfirm` runs the action and `onCancel` closes it.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive ? "bg-red-600 hover:bg-red-700" : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
