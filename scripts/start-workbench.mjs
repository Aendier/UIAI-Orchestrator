import { spawn } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";
import process from "node:process";

const candidatePorts = [4317, 4318];

async function isWorkbenchRunning(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(800)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function openBrowser(address) {
  if (process.platform !== "win32" || process.env.UI_AI_NO_OPEN === "1") return;
  const child = spawn("cmd", ["/c", "start", "", address], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  if (process.platform === "win32" && process.env.CODEX_API_KEY) {
    try {
      // Refresh even when reusing a running service, so the next standalone
      // launch uses the latest AIOA credential rather than a stale auth.json.
      const { tsImport } = await import("tsx/esm/api");
      const { loadModelConfig } = await tsImport("../src/ai/model-config.ts", import.meta.url);
      await loadModelConfig({ credentialCachePath: resolve(".local/aioa-credential.dpapi") });
    } catch {
      console.warn("AIOA 凭据缓存未能更新；工作台将继续尝试现有配置。");
    }
  }
  for (const port of checkOnly ? [] : candidatePorts) {
    if (await isWorkbenchRunning(port)) {
      const address = `http://127.0.0.1:${port}`;
      console.log(`UIAI 工作台已经在运行：${address}`);
      openBrowser(address);
      return;
    }
  }

  const port = await (async () => {
    if (checkOnly) return 0;
    for (const candidate of candidatePorts) {
      if (await isPortAvailable(candidate)) return candidate;
    }
    return undefined;
  })();

  if (port === undefined) {
    throw new Error("4317 和 4318 都已被占用，请关闭旧的工作台窗口后重试。");
  }

  const address = `http://127.0.0.1:${port}`;
  console.log(checkOnly ? "正在检查 UIAI 工作台启动…" : `正在启动 UIAI 工作台：${address}`);
  const child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "src/web/server.ts", ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: "inherit"
    }
  );

  child.once("error", (error) => {
    console.error(`工作台启动失败：${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`工作台已被 ${signal} 终止。`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
