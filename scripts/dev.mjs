import net from "node:net";
import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";

function findOpenPort(preferredPort) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", () => {
        tryPort(port + 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "0.0.0.0");
    };
    tryPort(preferredPort);
  });
}

function startWorkspace(name, port, extraEnv = {}) {
  const env = { ...process.env, PORT: String(port), ...extraEnv };
  const child = spawn(npmCmd, ["--workspace", name, "run", "dev"], {
    env,
    stdio: "inherit",
    shell: isWin
  });
  return child;
}

async function main() {
  const backendPort = await findOpenPort(Number(process.env.BACKEND_PORT ?? 4000));
  const frontendPort = await findOpenPort(Number(process.env.FRONTEND_PORT ?? 3000));
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? `http://localhost:${backendPort}`;

  console.log(`[dev] backend: http://localhost:${backendPort}`);
  console.log(`[dev] frontend: http://localhost:${frontendPort}`);
  console.log(`[dev] api base: ${apiBase}`);

  const backend = startWorkspace("backend", backendPort);
  const frontend = startWorkspace("frontend", frontendPort, { NEXT_PUBLIC_API_BASE: apiBase });
  const children = [backend, frontend];

  let exited = false;
  const shutdown = () => {
    if (exited) {
      return;
    }
    exited = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const child of children) {
    child.on("exit", (code) => {
      if (!exited) {
        exited = true;
        for (const other of children) {
          if (other !== child && !other.killed) {
            other.kill("SIGTERM");
          }
        }
        process.exit(code ?? 0);
      }
    });
  }
}

main().catch((error) => {
  console.error("[dev] failed to start:", error);
  process.exit(1);
});
