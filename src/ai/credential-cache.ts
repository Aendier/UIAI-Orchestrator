import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

const CredentialSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().min(1)
});
const EnvelopeSchema = z.object({
  version: z.literal(1),
  protection: z.literal("windows-dpapi-current-user"),
  data: z.string().min(1)
});

// Secrets travel over stdin/stdout pipes, never command-line arguments or scripts.
// DPAPI binds the encrypted payload to the current Windows user and computer.
function protectCredential(input: string, decrypt: boolean): Promise<string> {
  const operation = decrypt
    ? "$bytes = [Convert]::FromBase64String($inputData); $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($result))"
    : "$bytes = [Text.Encoding]::UTF8.GetBytes($inputData); $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "Add-Type -AssemblyName System.Security",
    "$inputData = [Console]::In.ReadToEnd()",
    "$entropy = [Text.Encoding]::UTF8.GetBytes('UIAI-Workbench-AIOA-credential-v1')",
    operation,
    "} catch { exit 1 }"
  ].join("\n");
  const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      timeout: 8_000,
      maxBuffer: 128 * 1024,
      encoding: "utf8"
    }, (error, stdout) => {
      // Child-process errors may contain captured output. Never propagate them.
      if (error || !stdout.trim()) reject(new Error("Windows credential encryption is unavailable."));
      else resolve(stdout.trim());
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input, "utf8");
  });
}

export async function readAioaCredential(path: string, baseUrl: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const envelope = EnvelopeSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const credential = CredentialSchema.parse(JSON.parse(await protectCredential(envelope.data, true)));
    // A cached token must never follow a provider address change.
    return credential.baseUrl.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, "")
      ? credential.apiKey : undefined;
  } catch {
    // Missing, damaged, or another Windows user's cache cannot prevent startup.
    return undefined;
  }
}

export async function saveAioaCredential(path: string, credential: z.infer<typeof CredentialSchema>): Promise<void> {
  if (process.platform !== "win32") return;
  const data = await protectCredential(JSON.stringify(CredentialSchema.parse(credential)), false);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, protection: "windows-dpapi-current-user", data }), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
