import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { getCurrentUserServerFn } from "../lib/auth";
import { Loader2 } from "lucide-react";
import { PROFESSION_RESTAURANT } from "../lib/restaurant-availability";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "BookMyTime — Workspace Dashboard Gateway" },
      {
        name: "description",
        content: "Redirecting to your customized workspace dashboard...",
      },
    ],
  }),
  component: DashboardRouterGateway,
});

function DashboardRouterGateway() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkUserAndRedirect() {
      try {
        const u = await getCurrentUserServerFn();
        if (!u) {
          navigate({ to: "/login" });
          return;
        }

        const profession = u.profession || "Healthcare and medical";
        if (profession === "Fitness Gym etc") {
          navigate({ to: "/dashboards/gym" });
        } else if (profession === "Beauty and wellness") {
          navigate({ to: "/dashboards/beauty" });
        } else if (profession === "Professional services like law, consultant, real estate, CA") {
          navigate({ to: "/dashboards/professional" });
        } else if (profession === "Education institutions") {
          navigate({ to: "/dashboards/education" });
        } else if (profession === PROFESSION_RESTAURANT) {
          // The generated route tree only learns "/dashboards/restaurant" once
          // that route file lands, so the target is widened here to keep this
          // added arm type-checking without altering any existing arm.
          navigate({ to: "/dashboards/restaurant" as any });
        } else {
          // Default to medical-dashboard
          navigate({ to: "/dashboards/medical" });
        }
      } catch (err: any) {
        console.error("Dashboard gateway redirection error:", err);
        setError("Unable to authenticate session. Redirecting to login...");
        setTimeout(() => {
          navigate({ to: "/login" });
        }, 2000);
      }
    }

    checkUserAndRedirect();
  }, [navigate]);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-zinc-50 font-sans">
      <div className="text-center space-y-4">
        {error ? (
          <p className="text-xs font-bold text-red-500 uppercase tracking-widest animate-in fade-in duration-200">
            {error}
          </p>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-zinc-950 mx-auto stroke-[2.5]" />
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Sync'ing your workspace dashboard...
            </p>
          </>
        )}
      </div>
    </div>
  );
}
