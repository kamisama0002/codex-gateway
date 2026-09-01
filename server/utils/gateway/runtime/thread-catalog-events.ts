import type { GatewayThread } from "~~/shared/types";

export type ThreadCatalogAction = "archived" | "unarchived" | "deleted";

export interface ThreadCatalogUpdate {
  hostId: number;
  threadId: string;
  action: ThreadCatalogAction;
  thread: GatewayThread | null;
}

type ThreadCatalogSubscriber = (update: ThreadCatalogUpdate) => void;

class ThreadCatalogEvents {
  private readonly subscribersByUser = new Map<number, Set<ThreadCatalogSubscriber>>();

  publish(userId: number, update: ThreadCatalogUpdate) {
    for (const subscriber of this.subscribersByUser.get(userId) ?? []) {
      try {
        subscriber(update);
      } catch (error) {
        console.warn("[gateway] thread catalog subscriber failed", error);
      }
    }
  }

  subscribe(userId: number, subscriber: ThreadCatalogSubscriber) {
    const subscribers = this.subscribersByUser.get(userId) ?? new Set<ThreadCatalogSubscriber>();
    subscribers.add(subscriber);
    this.subscribersByUser.set(userId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (!subscribers.size) this.subscribersByUser.delete(userId);
    };
  }
}

export const threadCatalogEvents = new ThreadCatalogEvents();
