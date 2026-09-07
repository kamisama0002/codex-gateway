import { expect, test, type Locator } from "@playwright/test";
import { openApp, reloadApp } from "./helpers/app";

test("renders the desktop companion at twice the previous size", async ({ page }) => {
  await openApp(page);

  const sprite = page.getByTestId("gateway-pet").locator('[role="img"]');
  await expect(sprite).toBeVisible();
  await expect.poll(() => elementBox(sprite).then((box) => box.width)).toBe(128);
});

test("drags the companion within the workspace and restores its saved position", async ({
  page,
}) => {
  await openApp(page);

  const workspace = page.getByTestId("chat-main-pane");
  const pet = page.getByTestId("gateway-pet");
  const sprite = pet.locator('[role="img"]');
  const initial = await elementBox(pet);
  const spriteBox = await elementBox(sprite);
  const workspaceBox = await elementBox(workspace);

  await page.mouse.move(spriteBox.x + spriteBox.width / 2, spriteBox.y + spriteBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(workspaceBox.x - 300, workspaceBox.y - 300, { steps: 8 });
  await page.mouse.up();

  const dragged = await elementBox(pet);
  expect(dragged.x).toBeLessThan(initial.x - 100);
  expect(dragged.x).toBeGreaterThanOrEqual(workspaceBox.x + 7);
  expect(dragged.y).toBeGreaterThanOrEqual(workspaceBox.y + 7);

  await reloadApp(page);
  const restored = await elementBox(pet);
  expect(restored.x).toBeCloseTo(dragged.x, 0);
  expect(restored.y).toBeCloseTo(dragged.y, 0);

  await page.setViewportSize({ width: 800, height: 500 });
  const resizedWorkspace = await elementBox(workspace);
  const resizedPet = await elementBox(pet);
  expect(resizedPet.x).toBeGreaterThanOrEqual(resizedWorkspace.x + 7);
  expect(resizedPet.y).toBeGreaterThanOrEqual(resizedWorkspace.y + 7);
  expect(resizedPet.x + resizedPet.width).toBeLessThanOrEqual(
    resizedWorkspace.x + resizedWorkspace.width - 7,
  );
  expect(resizedPet.y + resizedPet.height).toBeLessThanOrEqual(
    resizedWorkspace.y + resizedWorkspace.height - 7,
  );
});

async function elementBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected a visible element with a bounding box");
  return box;
}
