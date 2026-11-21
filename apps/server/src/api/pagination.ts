import { z } from "zod";

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().regex(/^\d{1,7}$/).optional(),
  page: z.enum(["true", "false"]).optional(),
});

export function paginate<T>(items: T[], input: { limit?: number | undefined; cursor?: string | undefined }) {
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const offset = Number(input.cursor ?? 0);
  return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? String(offset + limit) : null, total: items.length };
}

export function boundedView<T extends object>(view: T, input: { limit?: number | undefined; cursor?: string | undefined }) {
  const pagination: Record<string, unknown> = {};
  const result = Object.fromEntries(Object.entries(view).map(([key, value]) => {
    if (!Array.isArray(value)) return [key, value];
    const page = paginate(value, input);
    pagination[key] = { nextCursor: page.nextCursor, total: page.total };
    return [key, page.items];
  }));
  return { ...result, pagination };
}
