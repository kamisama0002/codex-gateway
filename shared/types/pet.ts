export type GatewayPetStatus = "idle" | "running" | "waiting" | "ready" | "failed";

export const GATEWAY_PET_IDS = [
  "codex",
  "dewey",
  "fireball",
  "rocky",
  "seedy",
  "stacky",
  "bsod",
  "null-signal",
] as const;

export type GatewayPetId = (typeof GATEWAY_PET_IDS)[number];

export function isGatewayPetId(value: string): value is GatewayPetId {
  return GATEWAY_PET_IDS.some((petId) => petId === value);
}

export interface GatewayPetSettings {
  enabled: boolean;
  petId: GatewayPetId;
  animations: boolean;
}
