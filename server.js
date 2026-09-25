const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const online = {};
const queue = {};

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    if (d.type === 'login' && d.user) {
      ws.user = String(d.user).toLowerCase(); console.log('login:', ws.user);
      online[ws.user] = ws;
      ws.send(JSON.stringify({ type: 'ok' }));
      (queue[ws.user] || []).forEach(m => ws.send(JSON.stringify(m)));
      queue[ws.user] = [];
    } else if (d.type === 'msg' && ws.user && d.to && d.text) {
      const to = String(d.to).toLowerCase();
      const m = { type: 'msg', from: ws.user, text: String(d.text), time: Date.now() };
      if (online[to] && online[to].readyState === 1) {
        online[to].send(JSON.stringify(m)); console.log('delivered to', to);
      } else {
        (queue[to] = queue[to] || []).push(m);
      }
    }
  });

  ws.on('close', () => {
    if (ws.user && online[ws.user] === ws) delete online[ws.user];
  });
});

console.log('Server running on port ' + PORT);
