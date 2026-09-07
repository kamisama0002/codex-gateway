import { userStore } from "../auth/users";

export const expiredSessionCleanupTask = {
  async run() {
    return { deleted: await userStore.deleteExpiredSessions() };
  },
};
