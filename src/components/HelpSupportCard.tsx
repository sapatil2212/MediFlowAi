import { LifeBuoy, Mail, Phone } from "lucide-react";

/**
 * Sidebar footer support block. Shown in every dashboard in place of the old
 * clickable profile card. Intentionally faint/low-contrast so it stays out of
 * the way, with tap-to-contact email and phone links.
 */
export function HelpSupportCard() {
  return (
    <div className="rounded-2xl bg-zinc-50 border border-zinc-200/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-3.5 w-3.5 text-zinc-400" />
        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
          Help &amp; Support
        </h4>
      </div>
      <div className="space-y-1.5">
        <a
          href="mailto:bookmytime1355@gmail.com"
          className="flex items-center gap-2 text-[11px] font-medium text-zinc-400 hover:text-brand transition-colors"
        >
          <Mail className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
          <span className="truncate">bookmytime1355@gmail.com</span>
        </a>
        <a
          href="tel:+919168081355"
          className="flex items-center gap-2 text-[11px] font-medium text-zinc-400 hover:text-brand transition-colors"
        >
          <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
          <span>+91 9168 08 1355</span>
        </a>
      </div>
    </div>
  );
}
