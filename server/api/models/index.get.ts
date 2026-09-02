import { getValidatedQuery } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { modelListSchema } from "../../utils/gateway/http/validation/models";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => modelListSchema.parse(body));
  const host = await requireWorkspaceHost(query.hostId);
  setGatewayRequestLogContext(event, "models/list", {
    ...hostLogContext(host),
    includeHidden: query.includeHidden ?? false,
    limit: query.limit,
    cursor: query.cursor ?? null,
  });

  return threadBroker.listModels(host, {
    includeHidden: query.includeHidden ?? false,
    limit: query.limit,
    cursor: query.cursor ?? null,
  });
});
