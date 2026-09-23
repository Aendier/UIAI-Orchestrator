import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import {
  MANAGER_PROTOCOL_VERSION,
  RepositoryScanSchema,
  RepositoryDescriptorSchema,
  type RepositoryDescriptor,
  type RepositoryScan
} from "../manager/protocol.js";

const execFileAsync = promisify(execFile);

const GitHubRepositoryPayloadSchema = z.object({
  nameWithOwner: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  url: z.url(),
  defaultBranchRef: z.object({ name: z.string().min(1) }).nullable(),
  description: z.string().nullable().optional()
});

const GitHubTreePayloadSchema = z.object({
  tree: z.array(z.object({
    path: z.string().min(1),
    type: z.string().min(1),
    sha: z.string().min(1).optional(),
    size: z.number().int().nonnegative().optional()
  })),
  truncated: z.boolean().optional()
});

const GitHubContentPayloadSchema = z.object({
  path: z.string().min(1),
  sha: z.string().min(1),
  encoding: z.enum(["base64", "none"]),
  content: z.string().optional(),
  truncated: z.boolean().optional()
});

const GitHubIssuePayloadSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  state: z.enum(["open", "closed"]),
  html_url: z.url(),
  labels: z.array(z.object({ name: z.string().min(1) })),
  pull_request: z.object({ url: z.url() }).optional()
});

const MAX_SCANNED_FILE_BYTES = 128 * 1024;
const MAX_SCANNED_FILES = 24;
const MAX_ISSUE_PAGES = 10;

export interface GitHubCommandRunner {
  (command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export interface GitHubRepositoryAdapter {
  describe(reference: string): Promise<RepositoryDescriptor>;
  scan?(repository: RepositoryDescriptor): Promise<RepositoryScan>;
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
    },
    async scan(repository) {
      const descriptor = RepositoryDescriptorSchema.parse(repository);
      const treeResult = await run("gh", [
        "api",
        `repos/${descriptor.id}/git/trees/${encodeURIComponent(descriptor.defaultBranch)}?recursive=1`
      ]);
      const tree = GitHubTreePayloadSchema.parse(JSON.parse(treeResult.stdout));
      const selectedCandidates = tree.tree
        .filter((entry) => entry.type === "blob")
        .map((entry) => ({
          path: entry.path,
          category: classifyScanPath(entry.path),
          sha: entry.sha,
          size: entry.size
        }))
        .filter((entry): entry is { path: string; category: "context" | "protocol" | "configuration"; sha: string | undefined; size: number | undefined } => Boolean(entry.category))
        .sort((left, right) => {
          const priority = (entry: typeof left): number => {
            if (/^context\.md$/i.test(entry.path)) return 0;
            if (/^context-map\.md$/i.test(entry.path)) return 1;
            if (entry.category === "context") return 2;
            if (entry.category === "protocol" && /(^|\/)docs\/adr\//i.test(entry.path)) return 3;
            if (entry.category === "protocol") return 4;
            return 5;
          };
          return priority(left) - priority(right) || left.path.localeCompare(right.path);
        });
      const filesTruncated = selectedCandidates.length > MAX_SCANNED_FILES;
      const selectedPaths = selectedCandidates.slice(0, MAX_SCANNED_FILES);
      const files = await Promise.all(selectedPaths.map(async ({ path, category, sha, size }) => {
        if (size !== undefined && size > MAX_SCANNED_FILE_BYTES && sha) {
          return {
            path,
            category,
            sha,
            content: "",
            truncated: true
          };
        }
        const result = await run("gh", [
          "api",
          `repos/${descriptor.id}/contents/${encodeRepositoryPath(path)}?ref=${encodeURIComponent(descriptor.defaultBranch)}`
        ]);
        const payload = GitHubContentPayloadSchema.parse(JSON.parse(result.stdout));
        const decoded = payload.encoding === "base64"
          ? Buffer.from((payload.content ?? "").replace(/\s+/g, ""), "base64")
          : Buffer.alloc(0);
        const truncated = Boolean(payload.truncated) || payload.encoding === "none" || decoded.byteLength > MAX_SCANNED_FILE_BYTES;
        return {
          path: payload.path,
          category,
          sha: payload.sha,
          content: decoded.subarray(0, MAX_SCANNED_FILE_BYTES).toString("utf8"),
          truncated
        };
      }));
      const issuePayloads: Array<z.infer<typeof GitHubIssuePayloadSchema>> = [];
      let issuesTruncated = false;
      for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
        const issuesResult = await run("gh", [
          "api",
          `repos/${descriptor.id}/issues?state=open&per_page=100&page=${page}`
        ]);
        const pagePayload = z.array(GitHubIssuePayloadSchema)
          .parse(JSON.parse(issuesResult.stdout));
        issuePayloads.push(...pagePayload);
        if (pagePayload.length < 100) break;
        if (page === MAX_ISSUE_PAGES) issuesTruncated = true;
      }
      const issues = issuePayloads.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        url: issue.html_url,
        labels: issue.labels.map((label) => label.name),
        isPullRequest: Boolean(issue.pull_request)
      }));
      return RepositoryScanSchema.parse({
        protocolVersion: MANAGER_PROTOCOL_VERSION,
        repositoryId: descriptor.id,
        defaultBranch: descriptor.defaultBranch,
        scannedAt: new Date().toISOString(),
        treeTruncated: Boolean(tree.truncated),
        filesTruncated,
        issuesTruncated,
        files,
        issues
      });
    }
  };
}

function classifyScanPath(path: string): "context" | "protocol" | "configuration" | undefined {
  const normalized = path.toLocaleLowerCase();
  const filename = normalized.split("/").pop() ?? normalized;
  if (/(^|\/)context(?:-map)?(?:\.md)?$/.test(normalized)) return "context";
  if (
    /(^|\/)(readme\.md|docs\/adr\/)/.test(normalized) ||
    /(^|\/)(protocol|schema|contract)([^/]*)(\.|\/|$)/.test(normalized)
  ) return "protocol";
  if (
    /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|build\.gradle|[^/]+\.csproj)$/.test(normalized) ||
    /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized) ||
    /^(tsconfig[^/]*\.json|dockerfile|\.editorconfig)$/.test(filename)
  ) return "configuration";
  return undefined;
}

function encodeRepositoryPath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function defaultRunner(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
}
