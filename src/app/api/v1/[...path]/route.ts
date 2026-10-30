import { dispatch } from "@/server/api/router";

/**
 * THIN HTTP ADAPTER — all logic lives in src/server (backend layer).
 * Next.js App Router catch-all: /api/v1/* → dispatch() into the backend router.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return dispatch(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
