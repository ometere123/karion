import type { Request, Response, NextFunction } from "express";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

// In development: cookies use sameSite:'lax' which prevents cross-site POST
// requests from navigation. In production: also enforce Origin header check.
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE.has(req.method)) {
    next();
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowed = process.env.FRONTEND_URL || "http://localhost:3000";

  let requestOrigin: string | null = null;
  if (origin) {
    requestOrigin = origin;
  } else if (referer) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      // malformed referer
    }
  }

  if (!requestOrigin || requestOrigin !== allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
