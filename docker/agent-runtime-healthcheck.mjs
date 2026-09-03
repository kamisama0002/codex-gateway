import { connect } from "node:net";

const socket = connect({ host: "127.0.0.1", port: 4500 });
const timeout = setTimeout(() => socket.destroy(new Error("App Server health check timed out")), 5_000);

socket.once("connect", () => {
  clearTimeout(timeout);
  socket.end();
  process.exit(0);
});
socket.once("error", () => {
  clearTimeout(timeout);
  process.exit(1);
});
