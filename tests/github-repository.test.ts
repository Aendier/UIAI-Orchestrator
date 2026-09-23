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
});
