const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const online = {};
const queue = {};

function tell(user, obj) {
  const w = online[user];
  if (w && w.readyState === 1) w.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    if (d.type === 'login' && d.user) {
      ws.user = String(d.user).toLowerCase();
      online[ws.user] = ws;
      ws.send(JSON.stringify({ type: 'ok' }));
      (queue[ws.user] || []).forEach(m => ws.send(JSON.stringify(m)));
      queue[ws.user] = [];
    } else if (d.type === 'msg' && ws.user && d.to && d.text) {
      const to = String(d.to).toLowerCase();
      const m = { type: 'msg', from: ws.user, text: String(d.text), time: Date.now(), id: d.id };
      if (online[to] && online[to].readyState === 1) {
        online[to].send(JSON.stringify(m));
        tell(ws.user, { type: 'status', to, state: 'delivered', id: d.id });
      } else {
        (queue[to] = queue[to] || []).push(m);
      }
    } else if (d.type === 'typing' && ws.user && d.to) {
      tell(String(d.to).toLowerCase(), { type: 'typing', from: ws.user });
    } else if (d.type === 'read' && ws.user && d.to) {
      tell(String(d.to).toLowerCase(), { type: 'status', to: ws.user, state: 'read', id: d.id });
    } else if (d.type === 'ping' && d.to) {
      tell(String(d.to).toLowerCase(), { type: 'presence' });
      ws.send(JSON.stringify({ type: 'presence_reply', online: !!(online[String(d.to).toLowerCase()]) }));
    }
  });

  ws.on('close', () => {
    if (ws.user && online[ws.user] === ws) delete online[ws.user];
  });
});

console.log('Server running on port ' + PORT);
