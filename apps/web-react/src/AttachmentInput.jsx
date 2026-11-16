import { useState } from "react";
import { post } from "./Board.jsx";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = [
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
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read file"));
        return;
      }
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AttachmentInput({ attachments, onChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    const next = [...attachments];
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          throw new Error(`${file.name} is larger than 8 MB`);
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
          throw new Error(`${file.name} is not an allowed file type`);
        }
        const data = await fileToBase64(file);
        const response = await post("/v1/uploads", {
          name: file.name,
          mimeType: file.type,
          data,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.message || `Upload failed for ${file.name}`);
        }
        const attachment = await response.json();
        next.push(attachment);
      }
      onChange(next);
    } catch (reason) {
      setError(reason.message || "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const remove = (index) => {
    const next = attachments.filter((_, i) => i !== index);
    onChange(next);
  };

  return (
    <div className="attachment-input">
      <label className="attachment-button">
        <span>{uploading ? "Uploading…" : "+ Attach files"}</span>
        <input
          type="file"
          multiple
          disabled={disabled || uploading || attachments.length >= 5}
          onChange={handleFiles}
          accept={ALLOWED_TYPES.join(",")}
        />
      </label>
      {attachments.length > 0 && (
        <ul className="attachment-list">
          {attachments.map((attachment, index) => (
            <li key={attachment.id}>
              <a href={attachment.url} target="_blank" rel="noreferrer">
                {attachment.name}
              </a>
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={disabled || uploading}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="form-status">{error}</p> : null}
    </div>
  );
}
