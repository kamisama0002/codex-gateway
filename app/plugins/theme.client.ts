import { createDinkyThemeController } from "@/utils/dinky-theme";

export default defineNuxtPlugin(() => {
  const controller = createDinkyThemeController();
  controller.start();

  return {
    provide: {
      themeController: controller,
    },
  };
});
