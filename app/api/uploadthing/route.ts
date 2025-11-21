import { createNextRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const { GET, POST } = createNextRouteHandler({
    router: ourFileRouter,
    config: {
        callbackUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/uploadthing` : undefined,
    },
});
