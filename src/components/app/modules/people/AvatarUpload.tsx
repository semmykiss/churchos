"use client";

/**
 * AvatarUpload — person photo with drag/drop or click-to-pick.
 * The client downscales the image to a 256×256 cover-cropped JPEG before
 * PATCHing /people/:id/photo as a base64 data URL (server stores the blob
 * in db/uploads via FileRecord and returns /api/v1/files/:id).
 * Falls back to PersonAvatar initials when no photo is set.
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

const OUTPUT_SIZE = 256;

/** Read + downscale to a square JPEG data URL (cover-crop). */
async function toSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(OUTPUT_SIZE / bitmap.width, OUTPUT_SIZE / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(bitmap, (OUTPUT_SIZE - w) / 2, (OUTPUT_SIZE - h) / 2, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function AvatarUpload({ personId, name, photoUrl, canEdit, className, onChanged }: {
  personId: string;
  name: string;
  photoUrl?: string | null;
  canEdit: boolean;
  className?: string;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick a PNG, JPEG or WebP image.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await toSquareDataUrl(file);
      await api.patch(`/people/${personId}/photo`, { dataUrl });
      toast.success("Photo updated");
      onChanged?.();
      void qc.invalidateQueries({ queryKey: ["people"] });
      void qc.invalidateQueries({ queryKey: ["households"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.patch(`/people/${personId}/photo`, { dataUrl: null });
      toast.success("Photo removed");
      onChanged?.();
      void qc.invalidateQueries({ queryKey: ["people"] });
      void qc.invalidateQueries({ queryKey: ["households"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return <PersonAvatar name={name} src={photoUrl} className={className} />;
  }

  return (
    <div className="relative shrink-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={photoUrl ? "Change photo" : "Upload photo"}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragOver && "ring-2 ring-ring",
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
      >
        {busy ? (
          <div className={cn("flex items-center justify-center rounded-full bg-muted", className ?? "h-12 w-12")}>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <PersonAvatar name={name} src={photoUrl} className={className} />
        )}
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="h-4 w-4 text-white" aria-hidden />
        </div>
      </div>
      {photoUrl ? (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full"
          aria-label="Remove photo"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void remove();
          }}
        >
          <Trash2 className="h-2.5 w-2.5" />
        </Button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Choose a photo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
