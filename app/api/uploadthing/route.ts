import { NextRequest } from "next/server";
import { createNextRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const { GET, POST } = createNextRouteHandler({
    router: ourFileRouter,
});
