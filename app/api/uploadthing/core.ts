import { createUploadthing, type FileRouter } from "uploadthing/next";
import { auth } from "@clerk/nextjs/server";

const f = createUploadthing();

export const ourFileRouter = {
  documentUploader: f({ image: { maxFileSize: "4MB" }, pdf: { maxFileSize: "4MB" } })
    .middleware(async () => {
      console.log("🔥 [Middleware] UploadThing Middleware executing...");
      try {
        const user = auth();
        console.log("🔥 [Middleware] Auth result:", user ? JSON.stringify(user) : "No user object");

        // TEMPORARY DEBUG: If auth fails, use a fallback instead of throwing
        if (!user || !user.userId) {
          console.warn("⚠️ [Middleware] No user found. Using DEBUG_FALLBACK_USER.");
          return { userId: "DEBUG_FALLBACK_USER" };
        }

        return { userId: user.userId };
      } catch (error) {
        console.error("🔥 [Middleware] CRITICAL AUTH ERROR:", error);
        // Fallback on error too, just to see if upload completes
        return { userId: "DEBUG_FALLBACK_ERROR_USER" };
      }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("Upload complete for userId:", metadata.userId);
      // ✅ FIX: Return something so the client knows it worked
      return { uploadedBy: metadata.userId, url: file.url };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;