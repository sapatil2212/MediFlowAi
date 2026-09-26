import { fork } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";

const globalForWa = globalThis as unknown as {
  waServerProcess?: any;
};

/** Truthy values accepted for the opt-out flag. */
function isTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(600);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

export async function startWhatsAppServer() {
  if (typeof window !== "undefined") return;

  // Opt-out for local development. Set WA_DISABLE_AUTOSTART=true to develop without it.
  if (isTruthy(process.env.WA_DISABLE_AUTOSTART)) {
    console.log("[WA Launcher] Skipped — WA_DISABLE_AUTOSTART is set.");
    return;
  }

  if (globalForWa.waServerProcess) {
    return;
  }

  const port = parseInt(process.env.WA_PORT || "3001");
  const alreadyRunning = await checkPortInUse(port);
  if (alreadyRunning) {
    console.log(`[WA Launcher] WhatsApp microservice is already active on port ${port}. Skipping spawn.`);
    return;
  }

  const scriptPath = path.resolve("./wa-server.cjs");
  if (!fs.existsSync(scriptPath)) {
    console.error(`[WA Launcher] Could not find wa-server.cjs at ${scriptPath}`);
    return;
  }

  console.log("[WA Launcher] Starting WhatsApp server process automatically...");

  function spawnProcess() {
    checkPortInUse(port).then((inUse) => {
      if (inUse) {
        console.log(`[WA Launcher] WhatsApp microservice is already active on port ${port}. Skipping spawn.`);
        return;
      }

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

          // If exited cleanly (code 0), do not restart
          if (code === 0) {
            console.log(
              "[WA Launcher] WhatsApp server process exited cleanly (port in use or normal exit). No restart needed.",
            );
            return;
          }

          checkPortInUse(port).then((stillInUse) => {
            if (stillInUse) {
              console.log(
                `[WA Launcher] WhatsApp microservice is active on port ${port}. No restart needed.`,
              );
              return;
            }

            // Circuit breaker: max 3 consecutive crash restarts within 60 seconds
            const now = Date.now();
            if (!globalForWa.lastRestartTime || now - globalForWa.lastRestartTime > 60000) {
              globalForWa.consecutiveRestarts = 0;
            }
            globalForWa.lastRestartTime = now;
            globalForWa.consecutiveRestarts = (globalForWa.consecutiveRestarts || 0) + 1;

            if (globalForWa.consecutiveRestarts > 3) {
              console.warn(
                `[WA Launcher] ⚠️ WhatsApp server failed 3 times consecutively. Halting auto-restart to prevent crash loop. Check port ${port}.`,
              );
              return;
            }

            console.log(
              `[WA Launcher] Restarting WhatsApp server process in 5 seconds (attempt ${globalForWa.consecutiveRestarts}/3)...`,
            );
            setTimeout(spawnProcess, 5000);
          });
        }
      });

      child.on("error", (err) => {
        console.error("[WA Launcher] WhatsApp server process error:", err);
      });

      globalForWa.waServerProcess = child;
    });
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
