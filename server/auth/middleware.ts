import type { Request, Response, NextFunction } from "express";
import { verifySupabaseToken } from "../supabase";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * Middleware that validates a Supabase Bearer token from the Authorization header.
 * Sets req.userId on success. Returns 401 on failure.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const userId = await verifySupabaseToken(token);

  if (!userId) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  (req as AuthenticatedRequest).userId = userId;
  next();
}
