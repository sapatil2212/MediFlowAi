import { fork } from "child_process";
import path from "path";
import fs from "fs";

const globalForWa = globalThis as unknown as {
  waServerProcess?: any;
};

export function startWhatsAppServer() {
  if (typeof window !== "undefined") return;

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
      console.log(`[WA Launcher] WhatsApp server process exited with code ${code} and signal ${signal}`);
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
