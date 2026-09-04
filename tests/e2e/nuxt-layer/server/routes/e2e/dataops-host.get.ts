import { setResponseHeader } from "h3";

export default defineEventHandler((event) => {
  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  setResponseHeader(event, "cache-control", "no-store");
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>DataOps E2E host</title></head>
  <body style="margin:0">
    <span id="gateway-status" data-status="loading" hidden></span>
    <iframe
      id="gateway-frame"
      src="http://codex.127.0.0.1.nip.io:3100/?embedded=1#dataops_ticket=one-time"
      referrerpolicy="strict-origin"
      style="border:0;width:100vw;height:100vh"
    ></iframe>
    <script>
      const frame = document.getElementById("gateway-frame");
      const status = document.getElementById("gateway-status");
      window.addEventListener("message", (event) => {
        if (
          event.origin !== "http://codex.127.0.0.1.nip.io:3100" ||
          event.source !== frame.contentWindow ||
          !event.data ||
          event.data.source !== "codex-gateway"
        ) return;
        status.dataset.status = event.data.type;
      });
    </script>
  </body>
</html>`;
});
