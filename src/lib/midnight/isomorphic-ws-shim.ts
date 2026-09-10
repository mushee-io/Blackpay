const BrowserWebSocket = globalThis.WebSocket;

if (typeof BrowserWebSocket !== "function") {
  throw new Error("WebSocket is unavailable in this runtime");
}

export const WebSocket = BrowserWebSocket;
export default BrowserWebSocket;
