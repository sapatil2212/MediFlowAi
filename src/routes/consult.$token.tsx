import { createFileRoute } from "@tanstack/react-router";
import { PatientConsultPage } from "../components/video/PatientConsultPage";

// Public, unauthenticated patient consultation route. Mirrors the tokenless
// pattern of `book.$tenantId.tsx` — no session lookup anywhere in the chain.
// The token in the path is the entire access credential (Req 6.3).
export const Route = createFileRoute("/consult/$token")({
  head: () => ({
    meta: [
      { title: "Video Consultation — BookMyTime" },
      { name: "description", content: "Join your secure video consultation." },
      // Consultation links should never be indexed or previewed.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ConsultRoute,
});

function ConsultRoute() {
  const { token } = Route.useParams();
  return <PatientConsultPage token={token} />;
}
