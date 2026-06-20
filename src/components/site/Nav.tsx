import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HeartPulse, ArrowRight, Menu, X } from "lucide-react";

const links = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/pricing", label: "Pricing" },
  { to: "/solutions", label: "Solutions" },
  { to: "/contact", label: "Contact" },
] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [path]);

  return (
    <div className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? "px-4 pt-3 pb-1" : ""}`}>
      <nav
        className={`transition-all duration-300 ${
          scrolled
            ? "mx-auto max-w-6xl rounded-2xl border border-zinc-200/70 bg-white/90 shadow-lg shadow-zinc-900/10 backdrop-blur-xl"
            : "border-b border-zinc-950/5 bg-transparent"
        }`}
      >
        <div className={`mx-auto flex items-center justify-between px-6 transition-all duration-300 ${scrolled ? "h-14 max-w-full" : "h-16 max-w-7xl"}`}>
        {/* Left side: Logo */}
        <div className="flex flex-1 justify-start">
          <Link to="/" className="group flex items-center gap-2">
            <div className="relative flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light ring-1 ring-brand/30">
              <HeartPulse className="size-4 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight">MediFlow AI</span>
          </Link>
        </div>

        {/* Center side: Links */}
        <div className="hidden md:flex flex-initial items-center justify-center gap-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeProps={{ className: "text-brand bg-brand/5" }}
              inactiveProps={{ className: "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-950/[0.03]" }}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Right side: Action buttons */}
        <div className="flex flex-1 items-center justify-end gap-2">
          <Link
            to="/login"
            className="hidden rounded-md border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 sm:block transition-all"
          >
            Login
          </Link>
          <Link
            to="/signup"
            className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 ring-1 ring-zinc-950/10 transition-transform hover:scale-[1.03]"
          >
            <span className="relative z-10 flex items-center gap-1.5">
              14 Days Free Trial
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-1 flex size-9 items-center justify-center rounded-md ring-1 ring-zinc-950/10 md:hidden"
            aria-label="Menu"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {open && (
        <div className={`border-t border-zinc-950/5 bg-white px-6 py-4 md:hidden ${scrolled ? "rounded-b-2xl" : ""}`}>
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                activeProps={{ className: "text-brand bg-brand/5" }}
                inactiveProps={{ className: "text-zinc-700" }}
                className="rounded-md px-3 py-2 text-sm font-medium"
              >
                {l.label}
              </Link>
            ))}
            <hr className="my-2 border-zinc-100" />
            <Link
              to="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="mt-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-50 text-center"
            >
              14 Days Free Trial
            </Link>
          </div>
        </div>
      )}
      </nav>
    </div>
  );
}

