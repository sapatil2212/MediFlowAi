// Client-safe re-exports for Doctor Report PDF generator and types.
// Server operations live in `./doctor-report.server.ts` to avoid bundling
// `mariadb`, `dotenv`, or `nodemailer` into the client browser bundle.
export * from "./doctor-report-pdf";
