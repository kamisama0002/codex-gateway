import { GATEWAY_PET_IDS, type GatewayPetId, type GatewayPetStatus } from "~~/shared/types";

export interface GatewayPetOption {
  id: GatewayPetId;
  name: string;
}

const PET_NAMES: Record<GatewayPetId, string> = {
  congming: "葱明仔",
  jiangjiang: "姜将仔",
  suanlele: "蒜乐乐",
};

const PET_ATLAS_ROWS: Record<GatewayPetId, number> = {
  congming: 9,
  jiangjiang: 11,
  suanlele: 11,
};

export const GATEWAY_PET_OPTIONS: GatewayPetOption[] = GATEWAY_PET_IDS.map((id) => ({
  id,
  name: PET_NAMES[id],
}));

export function petSpritesheetUrl(petId: GatewayPetId) {
  return `/pets/${petId}/spritesheet.webp`;
}

export function petSpritesheetRows(petId: GatewayPetId) {
  return PET_ATLAS_ROWS[petId];
}

export function petSpriteStyle(petId: GatewayPetId, frame: number) {
  const columns = 8;
  const rows = petSpritesheetRows(petId);
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  return {
    backgroundImage: `url(${JSON.stringify(petSpritesheetUrl(petId))})`,
    backgroundPosition: `${(column / (columns - 1)) * 100}% ${(row / (rows - 1)) * 100}%`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
  };
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
    frames: [32, 33, 34, 35, 36],
    frameDurationMs: 140,
    finalFrameDurationMs: 280,
  },
  failed: {
    frames: [40, 41, 42, 43, 44, 45, 46, 47],
    frameDurationMs: 140,
    finalFrameDurationMs: 240,
  },
};
