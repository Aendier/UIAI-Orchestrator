import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import {
  RepositoryDescriptorSchema,
  type RepositoryDescriptor
} from "../manager/protocol.js";

const execFileAsync = promisify(execFile);

const GitHubRepositoryPayloadSchema = z.object({
  nameWithOwner: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  url: z.url(),
  defaultBranchRef: z.object({ name: z.string().min(1) }).nullable(),
  description: z.string().nullable().optional()
});

export interface GitHubCommandRunner {
  (command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export interface GitHubRepositoryAdapter {
  describe(reference: string): Promise<RepositoryDescriptor>;
}

export function createGitHubRepositoryAdapter(options: {
  run?: GitHubCommandRunner;
} = {}): GitHubRepositoryAdapter {
  const run = options.run ?? defaultRunner;
  return {
    async describe(reference) {
      if (!/^[^/\s]+\/[^/\s]+$/.test(reference)) {
        throw new Error("GitHub repository reference must be owner/name.");
      }
      const result = await run("gh", [
        "repo",
        "view",
        reference,
        "--json",
        "nameWithOwner,url,defaultBranchRef,description"
      ]);
      const payload = GitHubRepositoryPayloadSchema.parse(JSON.parse(result.stdout));
      if (!payload.defaultBranchRef) {
        throw new Error(`GitHub repository has no default branch: ${reference}`);
      }
      return RepositoryDescriptorSchema.parse({
        id: payload.nameWithOwner,
        provider: "github",
        url: payload.url,
        defaultBranch: payload.defaultBranchRef.name,
        ...(payload.description === null || payload.description === undefined
          ? {}
          : { description: payload.description })
      });
    }
  };
}

async function defaultRunner(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
}
