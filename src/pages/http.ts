import type { IncomingMessage, ServerResponse } from "node:http";
import { PageError, type PageStore, type PagePlanner } from "./store.js";
import type { UsageStore } from "../ai/usage.js";

export async function handlePageRequest(request: IncomingMessage, response: ServerResponse,
  context: { pages: PageStore; usage: UsageStore; planner?: PagePlanner | undefined; readBody: () => Promise<unknown>; send: (value: unknown) => void }): Promise<boolean> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const method = request.method ?? "GET";
  if (path !== "/api/pages" && !path.startsWith("/api/pages/")) return false;
  if (path === "/api/pages") {
    if (method === "GET") context.send(await context.pages.list());
    else if (method === "POST") context.send(await context.pages.create(await context.readBody()));
    else throw new PageError(405, "Method not allowed.");
    return true;
  }
  const match = /^\/api\/pages\/([^/]+)(?:\/(analyze|edit|revise|assets|approve-structure|plan))?$/.exec(path);
  if (!match) throw new PageError(404, "Not found.");
  const pageId = decodeURIComponent(match[1]!); const action = match[2];
  if (method === "GET" && !action) context.send(await context.pages.get(pageId));
  else if (method === "GET" && action === "plan") {
    const plan = await context.pages.plan(pageId);
    response.setHeader("content-disposition", `attachment; filename="${plan.pageId}-r${plan.revision}.json"`);
    context.send(plan);
  } else if (method === "POST" && action) {
    const input = await context.readBody();
    if (action === "edit") context.send(await context.pages.edit(pageId, input));
    else if (action === "assets") context.send(await context.pages.asset(pageId, input));
    else if (action === "approve-structure") context.send(await context.pages.approve(pageId, input));
    else if (action === "analyze" || action === "revise") {
      if (!context.planner) throw new PageError(409, "请先配置支持图片的模型。");
      const planner = context.planner;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const closed = () => { if (!response.writableEnded) abort(); };
      request.once("aborted", abort); response.once("close", closed);
      try {
        const page = await context.pages.get(pageId);
        const value = await context.usage.track(action === "analyze" ? "page_analysis" : "page_revision", pageId, page.draft.input.page.name, async () => action === "analyze"
          ? await context.pages.analyze(pageId, input, planner, controller.signal)
          : await context.pages.revise(pageId, input, planner, controller.signal));
        if (!controller.signal.aborted && !response.destroyed) context.send(value);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally { request.off("aborted", abort); response.off("close", closed); }
    } else throw new PageError(405, "Method not allowed.");
  } else throw new PageError(405, "Method not allowed.");
  return true;
}
