import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { overlayPublicHosts } from "../../utils/gateway/runtime-manager/local-workspace";
import { hostStore } from "../../utils/gateway/state/hosts";

export default defineGatewayEventHandler(() => overlayPublicHosts(hostStore.list()));
