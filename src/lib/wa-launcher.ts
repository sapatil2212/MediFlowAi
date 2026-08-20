import { fork } from "child_process";
import path from "path";
import fs from "fs";

const globalForWa = globalThis as unknown as {
  waServerProcess?: any;
};

/** Truthy values accepted for the opt-out flag. */
function isTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function startWhatsAppServer() {
  if (typeof window !== "undefined") return;

  // Opt-out for local development. The WhatsApp service forks a Puppeteer
  // browser per connected tenant, which on a machine with several linked
  // tenants means dozens of Chrome processes competing with Vite. That CPU
  // starvation is enough to push a single large-module transform past Vite's
  // 60s transport timeout, surfacing as unrelated "transport invoke timed out"
  // SSR errors. Set WA_DISABLE_AUTOSTART=true to develop without it.
  //
  // Default is unchanged (auto-start on), so production behaviour is identical.
  if (isTruthy(process.env.WA_DISABLE_AUTOSTART)) {
    console.log("[WA Launcher] Skipped — WA_DISABLE_AUTOSTART is set.");
    return;
  }

  if (globalForWa.waServerProcess) {
    return;
  }

  const scriptPath = path.resolve("./wa-server.cjs");
  if (!fs.existsSync(scriptPath)) {
    console.error(`[WA Launcher] Could not find wa-server.cjs at ${scriptPath}`);
    return;
  }

  console.log("[WA Launcher] Starting WhatsApp server process automatically...");

  function spawnProcess() {
    const child = fork(scriptPath, [], {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV },
    });

    child.on("exit", (code, signal) => {
      console.log(
        `[WA Launcher] WhatsApp server process exited with code ${code} and signal ${signal}`,
      );
      if (globalForWa.waServerProcess === child) {
        globalForWa.waServerProcess = undefined;
        console.log("[WA Launcher] Restarting WhatsApp server process in 5 seconds...");
        setTimeout(spawnProcess, 5000);
      }
    });

    child.on("error", (err) => {
      console.error("[WA Launcher] WhatsApp server process error:", err);
    });

    globalForWa.waServerProcess = child;
  }

  spawnProcess();

  // Handle clean shutdown
  const cleanup = () => {
    if (globalForWa.waServerProcess) {
      console.log("[WA Launcher] Stopping WhatsApp server process...");
      try {
        globalForWa.waServerProcess.kill();
      } catch (_) {}
      globalForWa.waServerProcess = undefined;
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}
