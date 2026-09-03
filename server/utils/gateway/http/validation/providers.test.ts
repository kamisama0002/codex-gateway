import { describe, expect, it } from "vitest";
import { providerBaseUrlSchema } from "./providers";

describe("provider base URL validation", () => {
  it.each([
    "https://api.deepseek.com/v1",
    "http://127.0.0.1:18080/v1",
    "http://172.25.107.50:18080/v1",
    "http://192.168.48.20:8080/v1",
    "http://model-target:8080/v1",
  ])("accepts secure or private provider URL %s", (value) => {
    expect(providerBaseUrlSchema.parse(value)).toBe(value);
  });

  it.each([
    "http://api.example.com/v1",
    "ftp://10.0.0.2/models",
    "https://user:secret@api.example.com/v1",
    "https://api.example.com/v1?key=secret",
  ])("rejects unsafe provider URL %s", (value) => {
    expect(providerBaseUrlSchema.safeParse(value).success).toBe(false);
  });
});
