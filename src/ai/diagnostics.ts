import { z } from "zod";

export function describeAnalysisError(error: unknown, label = "模型返回结果"): string {
  if (error instanceof z.ZodError) {
    const details = error.issues.slice(0, 8).map(issue =>
      `${issue.path.join(".") || "根节点"}: ${issue.message}`).join("；");
    return `${label}未通过格式校验：${details}${error.issues.length > 8 ? "；其余问题已省略" : ""}`;
  }
  if (error instanceof Error && error.name === "AbortError") return "分析已停止。模型可能未返回本次消耗。";
  if (error instanceof SyntaxError) return "模型返回的文本不是有效的 JSON，请检查模型是否支持严格 JSON 输出。";
  if (error instanceof Error) {
    const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
    return [error.message, cause?.code, cause?.message].filter(value => typeof value === "string").join(" · ");
  }
  return "分析失败，服务未提供具体原因。";
}

export function redactModelError(message: string, apiKey = ""): string {
  const redacted = apiKey ? message.split(apiKey).join("[已隐藏密钥]") : message;
  return redacted.replace(/Bearer\s+\S+/gi, "Bearer [已隐藏密钥]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[已隐藏密钥]").slice(0, 2000);
}
