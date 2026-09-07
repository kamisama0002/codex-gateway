import { defineEventHandler } from "h3";
import { userStore } from "../../utils/gateway/auth/users";

export default defineEventHandler(async (event) => {
  await userStore.deleteToken(event.context.auth!.token);
  return { ok: true };
});
