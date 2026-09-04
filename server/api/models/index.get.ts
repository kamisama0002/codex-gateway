import { getValidatedQuery } from "h3";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { modelListResultSchema, modelListSchema } from "../../utils/gateway/http/validation/models";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { filterManagedModelCatalog } from "../../utils/gateway/providers/model-catalog";
import { providerStore } from "../../utils/gateway/providers/provider-store";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => modelListSchema.parse(body));
  const host = await requireWorkspaceHost(query.hostId);
  setGatewayRequestLogContext(event, "models/list", {
    ...hostLogContext(host),
    includeHidden: query.includeHidden ?? false,
    limit: query.limit,
    cursor: query.cursor ?? null,
  });

  const catalog = modelListResultSchema.parse(
    await threadBroker.listModels(host, {
      includeHidden: query.includeHidden ?? false,
      limit: query.limit,
      cursor: query.cursor ?? null,
    }),
  );
  if (!isManagedRuntimeHost(host)) return catalog;

  const user = requireAuthenticatedUser(event);
  return filterManagedModelCatalog(catalog, providerStore.listForUser(user.id));
});
