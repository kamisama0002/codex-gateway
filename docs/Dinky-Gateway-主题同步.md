# Dinky 与 Gateway 主题同步

Gateway 在嵌入 Dinky 时会把 `<html>` 根节点切换为 `light` 或 `dark`，并同步终端、文件预览和 Dockview 的主题。Dinky 的主题值沿用现有配置：`light` 表示白天，`realDark` 表示黑夜。

由于 Dinky（通常为 `:8888`）和 Gateway（通常为 `:8001`）是跨源 iframe，Gateway 不能直接读取 Dinky 的 `localStorage.navTheme`。Gateway 加载后会向父窗口发送：

```ts
{ source: "codex-gateway", type: "theme-request" }
```

Dinky 的 iframe 组件需要在 iframe 加载时，以及 Dinky 右上角主题切换完成后，向 Gateway 回复：

```ts
const sendGatewayTheme = () => {
  gatewayIframe.contentWindow?.postMessage(
    {
      source: "dinky",
      type: "theme-change",
      theme: localStorage.getItem("navTheme") ?? "light",
    },
    gatewayOrigin,
  );
};

gatewayIframe.addEventListener("load", sendGatewayTheme);
```

在 Dinky 的主题切换回调中再次调用 `sendGatewayTheme()` 即可实时同步。`gatewayOrigin` 必须是 Gateway 的完整源（例如 `http://172.25.106.252:8001`），不要使用 `*`。Gateway 只接受来自 `document.referrer` 或浏览器祖先源的父窗口消息，其他来源会被忽略。

独立打开 Gateway 时，也支持 `?theme=light`、`?theme=dark` 或 `?theme=realDark`，并以系统 `prefers-color-scheme` 作为最后 fallback。
