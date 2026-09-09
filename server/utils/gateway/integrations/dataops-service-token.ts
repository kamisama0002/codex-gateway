import { timingSafeEqual } from "node:crypto";

export const DATAOPS_SERVICE_TOKEN_ENV = "DATAOPS_SERVICE_TOKEN";
export const MIN_DATAOPS_SERVICE_TOKEN_LENGTH = 32;

/** Returns the configured long-lived bootstrap token without ever logging it. */
export function dataOpsServiceToken(environment: NodeJS.ProcessEnv = process.env): string {
  const token = environment[DATAOPS_SERVICE_TOKEN_ENV]?.trim() ?? "";
  if (token !== "" && token.length < MIN_DATAOPS_SERVICE_TOKEN_LENGTH) {
    throw new Error(
      `${DATAOPS_SERVICE_TOKEN_ENV} must be at least ${MIN_DATAOPS_SERVICE_TOKEN_LENGTH} characters`,
    );
  }
  return token;
}

export function matchesDataOpsServiceToken(
  presented: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = dataOpsServiceToken(environment);
  if (expected === "" || presented === "") return false;
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return (
    expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes)
  );
}
