import { createUploadthing, type FileRouter } from "uploadthing/next";
import { z } from "zod";

const f = createUploadthing();

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const ourFileRouter = {
  suggestionAttachment: f({
    image: { maxFileSize: "4MB", maxFileCount: 4 },
    pdf: { maxFileSize: "4MB", maxFileCount: 4 },
  })
    .input(z.object({ suggestionId: z.string().min(1) }))
    .middleware(async ({ req, input }) => {
      const cookieHeader = req.headers.get("cookie") ?? "";
      const meRes = await fetch(`${API_BASE}/auth/me`, {
        headers: { cookie: cookieHeader },
      });
      if (!meRes.ok) throw new Error("Unauthorized");
      const { user } = (await meRes.json()) as { user: { id: string } };
      return { userId: user.id, suggestionId: input.suggestionId };
    })
    .onUploadComplete(async ({ metadata }) => {
      return { suggestionId: metadata.suggestionId };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
