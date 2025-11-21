import { NextRequest } from "next/server";
import { createNextRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createNextRouteHandler({
    router: ourFileRouter,
});

export const GET = (req: NextRequest) => {
    console.log("🔥 [GET] /api/uploadthing HIT");
    return handlers.GET(req);
}

export const POST = (req: NextRequest) => {
    console.log("🔥 [POST] /api/uploadthing HIT");
    return handlers.POST(req);
}
