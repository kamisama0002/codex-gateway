import { GATEWAY_PET_IDS, type GatewayPetId, type GatewayPetStatus } from "~~/shared/types";

export interface GatewayPetOption {
  id: GatewayPetId;
  name: string;
}

const PET_NAMES: Record<GatewayPetId, string> = {
  codex: "Codex",
  dewey: "Dewey",
  fireball: "Fireball",
  rocky: "Rocky",
  seedy: "Seedy",
  stacky: "Stacky",
  bsod: "BSOD",
  "null-signal": "Null Signal",
};

export const GATEWAY_PET_OPTIONS: GatewayPetOption[] = GATEWAY_PET_IDS.map((id) => ({
  id,
  name: PET_NAMES[id],
}));

const PET_CDN_ROOT = "https://persistent.oaistatic.com/codex/pets/v1";

export function petSpritesheetUrl(petId: GatewayPetId) {
  return `${PET_CDN_ROOT}/${petId}-spritesheet-v4.webp`;
}

interface PetAnimation {
  frames: number[];
  frameDurationMs: number;
  finalFrameDurationMs: number;
}

export const PET_ANIMATIONS: Record<GatewayPetStatus, PetAnimation> = {
  idle: {
    frames: [0, 1, 2, 3, 4, 5],
    frameDurationMs: 840,
    finalFrameDurationMs: 1_920,
  },
  running: {
    frames: [56, 57, 58, 59, 60, 61],
    frameDurationMs: 120,
    finalFrameDurationMs: 220,
  },
  waiting: {
    frames: [48, 49, 50, 51, 52, 53],
    frameDurationMs: 150,
    finalFrameDurationMs: 260,
  },
  ready: {
    frames: [64, 65, 66, 67, 68, 69],
    frameDurationMs: 150,
    finalFrameDurationMs: 280,
  },
  failed: {
    frames: [40, 41, 42, 43, 44, 45, 46, 47],
    frameDurationMs: 140,
    finalFrameDurationMs: 240,
  },
};
