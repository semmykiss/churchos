"use client";

/**
 * Upload queue — drag-and-drop multi-file uploads with per-file XHR progress,
 * pause (abort), cancel, retry, and sequential workers. Progress is mirrored
 * into an aria-live announcement string for screen readers.
 *
 * Implementation note: the queue lives in a ref (itemsRef) mirrored into state
 * for rendering — workers always read the CURRENT queue, avoiding the classic
 * stale-closure bug when enqueuing files while another upload is in flight.
 */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { docKeys, uploadDocumentFile, type UploadHandle } from "../api/documents";
import type { DocumentDTO, UploadQueueItem } from "../types";

export interface UploadQueueApi {
  items: UploadQueueItem[];
  open: boolean;
  announcement: string;
  addFiles: (files: File[], meta: Record<string, unknown>) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
  close: () => void;
}

export function useUploadQueue(onDocumentUploaded?: (doc: DocumentDTO) => void): UploadQueueApi {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const itemsRef = useRef<UploadQueueItem[]>([]);
  const metaRef = useRef<Record<string, unknown>>({});
  const runningRef = useRef(false);
  const handleRef = useRef<UploadHandle | undefined>(undefined);
  const uploadedCbRef = useRef(onDocumentUploaded);
  uploadedCbRef.current = onDocumentUploaded;

  const commit = useCallback((updater: (prev: UploadQueueItem[]) => UploadQueueItem[]) => {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const patch = useCallback((id: string, data: Partial<UploadQueueItem>) => {
    commit((prev) => prev.map((it) => (it.id === id ? { ...it, ...data } : it)));
  }, [commit]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: docKeys.all() });
  }, [queryClient]);

  const runNext = useCallback(async () => {
    if (runningRef.current) return;
    const pending = itemsRef.current.find((it) => it.status === "queued");
    if (!pending) return;
    runningRef.current = true;
    patch(pending.id, { status: "uploading", progress: 0 });
    setAnnouncement(`Uploading ${pending.file.name}`);
    const handle = uploadDocumentFile(pending.file, metaRef.current, (pct) => patch(pending.id, { progress: pct }));
    handleRef.current = handle;
    try {
      const doc = await handle.promise;
      patch(pending.id, { status: "done", progress: 100, result: doc });
      setAnnouncement(`${pending.file.name} uploaded`);
      invalidate();
      uploadedCbRef.current?.(doc);
    } catch (err) {
      const aborted = err instanceof ApiError && (err.code === "aborted" || err.status === 499);
      const message = err instanceof ApiError ? err.message : "Upload failed.";
      patch(pending.id, { status: aborted ? "canceled" : "error", error: message });
      setAnnouncement(aborted ? `${pending.file.name} canceled` : `${pending.file.name} failed: ${message}`);
    } finally {
      runningRef.current = false;
      handleRef.current = undefined;
      // yield a tick, then pull the next queued file
      setTimeout(() => {
        queueMicrotask(() => {
          if (itemsRef.current.some((it) => it.status === "queued")) void runNext();
        });
      }, 50);
    }
  }, [patch, invalidate]);

  const addFiles = useCallback(
    (files: File[], meta: Record<string, unknown>) => {
      metaRef.current = meta;
      const stamped = Date.now();
      commit((prev) => [
        ...prev,
        ...files.map((file, i) => ({
          id: `${stamped}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          status: "queued" as const,
          progress: 0,
        })),
      ]);
      setOpen(true);
      setTimeout(() => void runNext(), 30);
    },
    [commit, runNext]
  );

  const retry = useCallback(
    (id: string) => {
      patch(id, { status: "queued", progress: 0, error: undefined });
      setTimeout(() => void runNext(), 30);
    },
    [patch, runNext]
  );

  const cancel = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((it) => it.id === id);
      if (item?.status === "uploading") handleRef.current?.abort();
      else patch(id, { status: "canceled" });
    },
    [patch]
  );

  const clearFinished = useCallback(() => {
    commit((prev) => prev.filter((it) => it.status === "queued" || it.status === "uploading"));
  }, [commit]);

  const close = useCallback(() => setOpen(false), []);

  return { items, open, announcement, addFiles, retry, cancel, clearFinished, close };
}
