import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const createSuggestionSchema = z.object({
  question: z.string().min(10, "Question too short").max(512),
  category: z.string().min(1).max(100),
  yesCondition: z.string().min(5).max(256),
  noCondition: z.string().min(5).max(256),
  invalidCondition: z.string().min(5).max(256),
  resolutionUrl: z.string().url("resolutionUrl must be a valid URL").max(512),
  resolutionQuery: z.string().min(10).max(512),
  resolutionDeadline: z.string().datetime("resolutionDeadline must be ISO 8601"),
  sourcePolicy: z.string().max(2000).optional(),
  evidencePriority: z.string().max(1000).optional(),
});

// POST /api/suggestions — submit a market suggestion
router.post(
  "/",
  requireAuth,
  validate(createSuggestionSchema),
  async (req: AuthRequest, res) => {
    try {
      const body = req.body as z.infer<typeof createSuggestionSchema>;

      const deadline = new Date(body.resolutionDeadline);
      if (deadline <= new Date()) {
        res.status(400).json({ error: "resolutionDeadline must be in the future" });
        return;
      }

      const suggestion = await prisma.marketSuggestion.create({
        data: {
          suggestedByUserId: req.user!.id,
          question: body.question,
          category: body.category,
          yesCondition: body.yesCondition,
          noCondition: body.noCondition,
          invalidCondition: body.invalidCondition,
          resolutionUrl: body.resolutionUrl,
          resolutionDeadline: deadline,
          sourcePolicy: body.sourcePolicy ?? "",
          evidencePriority: body.evidencePriority ?? "",
          resolutionQuery: body.resolutionQuery,
          status: "SUBMITTED",
        },
      });

      res.status(201).json({ suggestion });
    } catch (err) {
      console.error("[suggestions/create]", err);
      res.status(500).json({ error: "Failed to create suggestion" });
    }
  }
);

// GET /api/suggestions — list the authenticated user's own suggestions
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const suggestions = await prisma.marketSuggestion.findMany({
      where: { suggestedByUserId: req.user!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        question: true,
        category: true,
        status: true,
        resolutionDeadline: true,
        resolutionUrl: true,
        reviewNotes: true,
        createdAt: true,
        updatedAt: true,
        market: { select: { onChainMarketId: true, status: true } },
      },
    });

    res.json({ suggestions });
  } catch (err) {
    console.error("[suggestions/list]", err);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// GET /api/suggestions/:id — single suggestion detail (owner or admin)
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const suggestion = await prisma.marketSuggestion.findUnique({
      where: { id: String(req.params.id) },
      include: { market: true },
    });

    if (!suggestion) {
      res.status(404).json({ error: "Suggestion not found" });
      return;
    }

    const isOwner = suggestion.suggestedByUserId === req.user!.id;
    const isAdmin = req.user!.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    res.json({ suggestion });
  } catch (err) {
    console.error("[suggestions/detail]", err);
    res.status(500).json({ error: "Failed to fetch suggestion" });
  }
});

const attachmentSchema = z.object({
  fileUrl: z.string().url("fileUrl must be a valid URL"),
  fileKey: z.string().min(1).max(255),
  fileType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(4 * 1024 * 1024),
});

// POST /api/suggestions/:id/attachments — save UploadThing file metadata (owner or admin)
router.post(
  "/:id/attachments",
  requireAuth,
  validate(attachmentSchema),
  async (req: AuthRequest, res) => {
    try {
      const suggestion = await prisma.marketSuggestion.findUnique({
        where: { id: String(req.params.id) },
      });

      if (!suggestion) {
        res.status(404).json({ error: "Suggestion not found" });
        return;
      }

      const isOwner = suggestion.suggestedByUserId === req.user!.id;
      const isAdmin = req.user!.role === "ADMIN";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const { fileUrl, fileKey, fileType, fileSize } = req.body as z.infer<typeof attachmentSchema>;

      const isValidType =
        fileType.startsWith("image/") || fileType === "application/pdf";
      if (!isValidType) {
        res.status(400).json({ error: "Only images and PDFs are allowed" });
        return;
      }

      const attachment = await prisma.uploadedFile.create({
        data: {
          userId: req.user!.id,
          relatedType: "SUGGESTION",
          relatedId: suggestion.id,
          fileUrl,
          fileKey,
          fileType,
          fileSize,
        },
      });

      res.status(201).json({ attachment });
    } catch (err) {
      console.error("[suggestions/attachments/create]", err);
      res.status(500).json({ error: "Failed to save attachment" });
    }
  }
);

// GET /api/suggestions/:id/attachments — list attachments (owner or admin)
router.get("/:id/attachments", requireAuth, async (req: AuthRequest, res) => {
  try {
    const suggestion = await prisma.marketSuggestion.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!suggestion) {
      res.status(404).json({ error: "Suggestion not found" });
      return;
    }

    const isOwner = suggestion.suggestedByUserId === req.user!.id;
    const isAdmin = req.user!.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const attachments = await prisma.uploadedFile.findMany({
      where: { relatedType: "SUGGESTION", relatedId: suggestion.id },
      orderBy: { createdAt: "asc" },
    });

    res.json({ attachments });
  } catch (err) {
    console.error("[suggestions/attachments/list]", err);
    res.status(500).json({ error: "Failed to fetch attachments" });
  }
});

export default router;
