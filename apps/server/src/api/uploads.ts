import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import type { Actor, Attachment } from "@spark/contracts";

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  data: z.string().min(1).max(12 * 1024 * 1024),
});

export class UploadStore {
  constructor(private readonly pool: Pool) {}

  async store(input: {
    name: string;
    mimeType: string;
    data: string;
    actor: Actor;
  }): Promise<Attachment> {
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid upload");
    }

    const buffer = Buffer.from(input.data, "base64");
    if (buffer.length === 0) throw new Error("Empty file data");
    if (buffer.length > 10 * 1024 * 1024) throw new Error("File exceeds 10 MB limit");

    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO uploads (id, filename, mime_type, size, uploaded_by, data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.name.slice(0, 200), input.mimeType, buffer.length, input.actor.id, buffer],
    );

    return {
      id,
      name: input.name.slice(0, 200),
      url: `/uploads/${id}`,
      mimeType: input.mimeType,
      size: buffer.length,
      uploadedBy: input.actor,
      uploadedAt: new Date().toISOString(),
    };
  }

  async fetch(id: string): Promise<{ filename: string; mimeType: string; data: Buffer } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return null;
    }
    const result = await this.pool.query(
      "SELECT filename, mime_type, data FROM uploads WHERE id = $1",
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      filename: row.filename,
      mimeType: row.mime_type,
      data: row.data,
    };
  }
}
