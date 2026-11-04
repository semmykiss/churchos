"use client";

/**
 * Document mutations — optimistic updates with rollback + undo toast for
 * trash, and granular cache invalidation through the query key factory.
 */
import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { docKeys } from "../api/documents";
import * as api from "../api/documents";
import type { DocumentDTO, DocumentsListResp } from "../types";

/** Patch a document inside every cached list page + the open detail cache. */
function patchDocEverywhere(client: QueryClient, id: string, patch: Partial<DocumentDTO>) {
  client.setQueriesData<DocumentsListResp>({ queryKey: docKeys.all() }, (data) =>
    data
      ? { ...data, items: data.items.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
      : data
  );
  client.setQueryData<unknown>(docKeys.detail(id), (old) => {
    if (!old || typeof old !== "object") return old;
    const detail = old as { document: DocumentDTO };
    return { ...detail, document: { ...detail.document, ...patch } };
  });
}

function removeDocEverywhere(client: QueryClient, id: string) {
  client.setQueriesData<DocumentsListResp>({ queryKey: docKeys.all() }, (data) =>
    data ? { ...data, items: data.items.filter((d) => d.id !== id), total: Math.max(0, data.total - 1) } : data
  );
}

export function useDocumentMutations() {
  const queryClient = useQueryClient();

  const refreshLists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: docKeys.all() });
  }, [queryClient]);

  // ── favorites (optimistic) ────────────────────────────────────────────────
  const toggleFavorite = useCallback(
    async (doc: DocumentDTO) => {
      const next = !doc.favorite;
      patchDocEverywhere(queryClient, doc.id, { favorite: next });
      try {
        await api.toggleFavorite(doc.id);
      } catch (err) {
        patchDocEverywhere(queryClient, doc.id, { favorite: doc.favorite });
        toast.error(err instanceof Error ? err.message : "Could not update favorite.");
      }
    },
    [queryClient]
  );

  // ── trash with undo toast (optimistic remove, rollback via undo) ──────────
  const trashDocument = useCallback(
    (doc: DocumentDTO) => {
      removeDocEverywhere(queryClient, doc.id);
      const undo = () => {
        api.restoreDocument(doc.id).then(
          () => {
            refreshLists();
            toast.success(`"${doc.title}" restored.`);
          },
          (err) => toast.error(err instanceof Error ? err.message : "Restore failed.")
        );
      };
      api
        .trashDocument(doc.id)
        .then(() => {
          refreshLists();
          toast.success(`"${doc.title}" moved to Trash.`, {
            action: { label: "Undo", onClick: undo },
            duration: 8000,
          });
        })
        .catch((err) => {
          refreshLists();
          toast.error(err instanceof Error ? err.message : "Could not move to Trash.");
        });
    },
    [queryClient, refreshLists]
  );

  const restoreDocument = useCallback(
    async (doc: DocumentDTO) => {
      try {
        await api.restoreDocument(doc.id);
        refreshLists();
        toast.success(`"${doc.title}" restored.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Restore failed.");
      }
    },
    [refreshLists]
  );

  const purgeDocument = useCallback(
    async (doc: DocumentDTO) => {
      try {
        await api.purgeDocument(doc.id);
        refreshLists();
        toast.success(`"${doc.title}" permanently deleted.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Permanent delete failed.");
      }
    },
    [refreshLists]
  );

  // ── metadata / workflow ───────────────────────────────────────────────────
  const updateDocument = useCallback(
    async (id: string, body: Record<string, unknown>, quiet = false) => {
      try {
        const doc = await api.updateDocument(id, body);
        patchDocEverywhere(queryClient, id, doc);
        queryClient.invalidateQueries({ queryKey: docKeys.detail(id) });
        if (!quiet) toast.success("Document updated.");
        return doc;
      } catch (err) {
        if (!quiet) toast.error(err instanceof Error ? err.message : "Update failed.");
        throw err;
      }
    },
    [queryClient]
  );

  const runWorkflow = useCallback(
    async (id: string, action: string, note?: string) => {
      try {
        await api.runWorkflow(id, action, note);
        refreshLists();
        toast.success(
          action === "approve" ? "Document approved." :
          action === "reject" ? "Document sent back to draft." :
          action === "publish" ? "Document published." :
          action === "archive" ? "Document archived." :
          action === "submit" ? "Submitted for review." : "Done."
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Workflow action failed.");
        throw err;
      }
    },
    [refreshLists]
  );

  // ── sharing ───────────────────────────────────────────────────────────────
  const createShareLink = useCallback(
    async (id: string, body: { expiresInHours?: number | null; password?: string; maxDownloads?: number | null }) => {
      try {
        const link = await api.createShareLink(id, body);
        queryClient.invalidateQueries({ queryKey: docKeys.detail(id) });
        return link;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create share link.");
        throw err;
      }
    },
    [queryClient]
  );

  const revokeShareLink = useCallback(
    async (id: string, linkId: string) => {
      try {
        await api.revokeShareLink(id, linkId);
        queryClient.invalidateQueries({ queryKey: docKeys.detail(id) });
        toast.success("Share link revoked.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Revoke failed.");
      }
    },
    [queryClient]
  );

  // ── lock / legal hold ─────────────────────────────────────────────────────
  const lock = useCallback(
    async (id: string) => {
      try {
        await api.lockDocument(id);
        refreshLists();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Check-out failed.");
      }
    },
    [refreshLists]
  );
  const unlock = useCallback(
    async (id: string) => {
      try {
        await api.unlockDocument(id);
        refreshLists();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Check-in failed.");
      }
    },
    [refreshLists]
  );
  const setLegalHold = useCallback(
    async (id: string, value: boolean) => {
      try {
        await api.setLegalHold(id, value);
        refreshLists();
        toast.success(value ? "Legal hold applied." : "Legal hold released.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not change legal hold.");
      }
    },
    [refreshLists]
  );

  // ── versions ──────────────────────────────────────────────────────────────
  const restoreVersion = useCallback(
    async (id: string, versionId: string) => {
      try {
        await api.restoreVersion(id, versionId);
        refreshLists();
        toast.success("Version restored as the new current version.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Restore failed.");
      }
    },
    [refreshLists]
  );

  // ── comments ──────────────────────────────────────────────────────────────
  const addComment = useCallback(
    async (id: string, body: string) => {
      try {
        await api.addComment(id, body);
        queryClient.invalidateQueries({ queryKey: docKeys.comments(id) });
        queryClient.invalidateQueries({ queryKey: docKeys.detail(id) });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not post comment.");
        throw err;
      }
    },
    [queryClient]
  );
  const deleteComment = useCallback(
    async (id: string, commentId: string) => {
      try {
        await api.deleteComment(id, commentId);
        queryClient.invalidateQueries({ queryKey: docKeys.comments(id) });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove comment.");
      }
    },
    [queryClient]
  );

  // ── bulk ──────────────────────────────────────────────────────────────────
  const bulk = useCallback(
    async (body: Parameters<typeof api.bulkOperation>[0]) => {
      try {
        const result = await api.bulkOperation(body);
        refreshLists();
        if (result.skipped.length) {
          toast.warning(`${result.updated.length} updated, ${result.skipped.length} skipped`, {
            description: result.skipped[0]?.reason,
          });
        } else {
          toast.success(`${result.updated.length} document(s) updated.`);
        }
        return result;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Bulk action failed.");
        throw err;
      }
    },
    [refreshLists]
  );

  // ── folders ───────────────────────────────────────────────────────────────
  const createFolder = useCallback(
    async (name: string, parentId?: string) => {
      try {
        await api.createFolder({ name, parentId });
        queryClient.invalidateQueries({ queryKey: docKeys.folders() });
        toast.success(`Folder "${name}" created.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create folder.");
        throw err;
      }
    },
    [queryClient]
  );

  const saveSettings = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await api.saveSettings(body);
        queryClient.invalidateQueries({ queryKey: docKeys.settings() });
        toast.success("DMS settings saved.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save settings.");
        throw err;
      }
    },
    [queryClient]
  );

  return {
    toggleFavorite, trashDocument, restoreDocument, purgeDocument, updateDocument,
    runWorkflow, createShareLink, revokeShareLink, lock, unlock, setLegalHold,
    restoreVersion, addComment, deleteComment, bulk, createFolder, saveSettings, refreshLists,
  };
}
