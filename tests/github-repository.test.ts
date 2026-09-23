import { describe, expect, it, vi } from "vitest";

import { createGitHubRepositoryAdapter } from "../src/github/repository.js";

describe("GitHub repository adapter", () => {
  it("reads a repository descriptor without exposing credentials to the manager", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        nameWithOwner: "acme/client",
        url: "https://github.com/acme/client",
        defaultBranchRef: { name: "main" },
        description: "Client repository"
      }),
      stderr: ""
    });
    const adapter = createGitHubRepositoryAdapter({ run });

    await expect(adapter.describe("acme/client")).resolves.toEqual({
      id: "acme/client",
      provider: "github",
      url: "https://github.com/acme/client",
      defaultBranch: "main",
      description: "Client repository"
    });
    expect(run).toHaveBeenCalledWith(
      "gh",
      [
        "repo",
        "view",
        "acme/client",
        "--json",
        "nameWithOwner,url,defaultBranchRef,description"
      ]
    );
  });

  it("rejects an invalid repository reference before invoking gh", async () => {
    const run = vi.fn();
    const adapter = createGitHubRepositoryAdapter({ run });

    await expect(adapter.describe("not-a-repository")).rejects.toThrow(
      "GitHub repository reference must be owner/name"
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("scans protocol files and open issues through read-only gh api calls", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      const endpoint = args[1] ?? "";
      if (endpoint.includes("git/trees")) {
        return {
          stdout: JSON.stringify({
            tree: [
              { path: "CONTEXT.md", type: "blob" },
              { path: "docs/adr/0003-manager-owned-cross-repository-coordination.md", type: "blob" },
              { path: "package.json", type: "blob" },
              { path: "src/index.ts", type: "blob" }
            ],
            truncated: false
          }),
          stderr: ""
        };
      }
      if (endpoint.includes("/issues?")) {
        return {
          stdout: JSON.stringify([
            {
              number: 12,
              title: "Align protocol",
              state: "open",
              html_url: "https://github.com/acme/client/issues/12",
              labels: [{ name: "ready-for-agent" }]
            },
            {
              number: 13,
              title: "External pull request",
              state: "open",
              html_url: "https://github.com/acme/client/pull/13",
              labels: [],
              pull_request: { url: "https://api.github.com/repos/acme/client/pulls/13" }
            }
          ]),
          stderr: ""
        };
      }
      const path = endpoint.split("/contents/")[1]?.split("?")[0];
      const content = path === "CONTEXT.md"
        ? "# Context\nManager protocol"
        : path?.startsWith("docs/adr/")
          ? "# ADR 0003\nManager owns coordination"
          : '{"name":"client","scripts":{"test":"vitest"}}';
      return {
        stdout: JSON.stringify({
          path,
          sha: `sha-${path}`,
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
          size: content.length,
          truncated: false
        }),
        stderr: ""
      };
    });
    const adapter = createGitHubRepositoryAdapter({ run });
    const repository = {
      id: "acme/client",
      provider: "github" as const,
      url: "https://github.com/acme/client",
      defaultBranch: "main"
    };

    await expect(adapter.scan!(repository)).resolves.toMatchObject({
      repositoryId: "acme/client",
      defaultBranch: "main",
      treeTruncated: false,
      filesTruncated: false,
      issuesTruncated: false,
      files: [
        { path: "CONTEXT.md", category: "context", content: "# Context\nManager protocol" },
        {
          path: "docs/adr/0003-manager-owned-cross-repository-coordination.md",
          category: "protocol"
        },
        { path: "package.json", category: "configuration" }
      ],
      issues: [
        {
          number: 12,
          title: "Align protocol",
          isPullRequest: false,
          labels: ["ready-for-agent"]
        },
        {
          number: 13,
          title: "External pull request",
          isPullRequest: true
        }
      ]
    });
    expect(run).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/client/git/trees/main?recursive=1"]
    );
    expect(run).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/client/issues?state=open&per_page=100&page=1"]
    );
  });

  it("records large content as truncated and marks issue pagination limits", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      const endpoint = args[1] ?? "";
      if (endpoint.includes("git/trees")) {
        return {
          stdout: JSON.stringify({
            tree: [{ path: "package-lock.json", type: "blob", sha: "sha-large", size: 200_000 }],
            truncated: false
          }),
          stderr: ""
        };
      }
      if (endpoint.includes("/issues?")) {
        const page = Number(new URLSearchParams(endpoint.split("?")[1]).get("page"));
        return {
          stdout: JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
            number: page * 100 + index + 1,
            title: `Issue ${page}-${index}`,
            state: "open",
            html_url: `https://github.com/acme/client/issues/${page * 100 + index + 1}`,
            labels: []
          }))),
          stderr: ""
        };
      }
      throw new Error(`Unexpected content request: ${endpoint}`);
    });
    const adapter = createGitHubRepositoryAdapter({ run });

    const scan = await adapter.scan!({
      id: "acme/client",
      provider: "github",
      url: "https://github.com/acme/client",
      defaultBranch: "main"
    });

    expect(scan.files).toEqual([{
      path: "package-lock.json",
      category: "configuration",
      sha: "sha-large",
      content: "",
      truncated: true
    }]);
    expect(scan.filesTruncated).toBe(false);
    expect(scan.issues).toHaveLength(1000);
    expect(scan.issuesTruncated).toBe(true);
    expect(run.mock.calls.filter(([, args]) => (args[1] ?? "").includes("/issues?")).length).toBe(10);
  });
});
