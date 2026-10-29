import { encode, decode } from './protocol.js';

// onOpen and onClose are optional. The phone passes only (onMessage, onOpen) and reads `.ws`.
export function connect(onMessage, onOpen, onClose) {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/ws`);
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('close', () => onClose?.());
  ws.addEventListener('message', (e) => {
    const msg = decode(e.data);
    if (msg) onMessage(msg);
  });
  return {
    ws,
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
    },
  };
}
