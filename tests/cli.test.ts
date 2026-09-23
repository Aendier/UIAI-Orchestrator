import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("CLI", () => {
  it("adapts Bridge JSON into safe component observations", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "uiai-orchestrator-"));
    const outputPath = join(outputDirectory, "observations.json");

    await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "adapt",
        "--input",
        resolve("fixtures/bridge-components.json"),
        "--output",
        outputPath
      ],
      { cwd: resolve(".") }
    );

    const output = JSON.parse(await readFile(outputPath, "utf8")) as {
      schemaVersion: string;
      observations: Array<{ root: Record<string, unknown> }>;
    };

    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.observations).toHaveLength(12);
    expect(output.observations[0]?.root).toMatchObject({
      sourceId: "guid-reward-claim",
      name: "RewardClaimButton",
      nodeType: "INSTANCE"
    });
    expect(JSON.stringify(output)).not.toContain("serializedFields");
    expect(JSON.stringify(output)).not.toContain("private-guid");
    expect(output.observations[1]?.root).toMatchObject({
      children: [
        expect.anything(),
        {
          text: {
            characters: "100",
            fontFamily: "GameFont",
            fontStyle: "Regular",
            fontSize: 18
          }
        }
      ]
    });
  });

  it("requires explicit approval before natural-language registry search", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "uiai-orchestrator-"));
    const registryPath = join(outputDirectory, "registry.json");
    const resultPath = join(outputDirectory, "search-result.json");

    await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "approve",
        "--draft",
        resolve("fixtures/reward-claim-draft.json"),
        "--registry",
        registryPath,
        "--id",
        "button.reward.claim",
        "--reviewer",
        "test-reviewer",
        "--use-case",
        "领取奖励",
        "--visual-trait",
        "宽按钮"
      ],
      { cwd: resolve(".") }
    );

    await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "search",
        "--registry",
        registryPath,
        "--query",
        "用于领取奖励的按钮",
        "--output",
        resultPath
      ],
      { cwd: resolve(".") }
    );

    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      components: Array<{ status: string; approvedBy: string }>;
    };
    const result = JSON.parse(await readFile(resultPath, "utf8")) as {
      status: string;
      matches: Array<{ componentId: string }>;
    };

    expect(registry.components).toHaveLength(1);
    expect(registry.components[0]).toMatchObject({
      status: "approved",
      approvedBy: "test-reviewer"
    });
    expect(result).toMatchObject({
      status: "match",
      matches: [{ componentId: "button.reward.claim" }]
    });
  });
});
