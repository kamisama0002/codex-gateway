import { normalizeThreadTitle } from "~~/shared/thread-title";
import { userConfigMutationService } from "../config/user-config-mutation-service";
import { threadMetadataStore } from "../state/thread-metadata";
import { threadSnapshotStore } from "../state/thread-snapshots";

export function projectThreadTitle(
  userId: number,
  hostId: number,
  threadId: string,
  title: string,
) {
  const normalized = normalizeThreadTitle(title);
  if (normalized === "") return;
  threadMetadataStore.updateTitle(hostId, threadId, normalized);
  threadSnapshotStore.update(hostId, threadId, (snapshot) =>
    snapshot === null
      ? null
      : {
          ...snapshot,
          thread: { ...snapshot.thread, name: normalized },
        },
  );
  userConfigMutationService.updatePinnedThreadTitle(userId, hostId, threadId, normalized);
}
