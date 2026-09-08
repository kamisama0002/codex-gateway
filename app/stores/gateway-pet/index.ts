import { computed } from "vue";
import { storeToRefs } from "pinia";
import { normalizePetSettings } from "@/stores/gateway/config";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { gatewayPetStatus } from "./status";

export function useGatewayPet() {
  const config = useGatewayConfigStore();
  const navigation = useGatewayNavigationStore();
  const runtime = useGatewayThreadRuntimeStore();
  const { timelineTurns } = storeToRefs(useGatewayThreadViewStore());

  const settings = computed(() => normalizePetSettings(config.gatewayConfig.pet));
  const status = computed(() => {
    const hostId = navigation.selectedHostId;
    const threadId = navigation.selectedThreadId;
    return gatewayPetStatus({
      hasThread: hostId !== null && threadId !== null,
      runtimeStatus:
        hostId !== null && threadId !== null ? runtime.statusFor(hostId, threadId) : "idle",
      items: timelineTurns.value.flatMap((turn) => turn.items),
    });
  });

  return { settings, status };
}
