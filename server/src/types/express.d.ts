// Augments Express's Request with the authenticated user id, set by
// middleware/auth.ts. Every scoped route reads req.userId — never a
// client-supplied id — see docs/MASTER_BUILD_PROMPT_v3_BACKEND.md rule 1.
declare namespace Express {
  export interface Request {
    userId?: number;
    // Set by middleware/requireAdmin.ts after a fresh DB lookup — never trust a client claim.
    role?: string;
  }
}
