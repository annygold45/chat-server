const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const app = express();
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + ext);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.get('/', (req, res) => res.send('Chat server running'));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.json());

const PROFILE_FILE = path.join(__dirname, 'profiles.json');
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch (e) {}

function saveProfiles() {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profiles));
}

app.get('/profile/:user', (req, res) => {
  const u = req.params.user.toLowerCase();
  res.json(profiles[u] || { name: u, status: '', avatarUrl: '' });
});

app.post('/profile/:user', (req, res) => {
  const u = req.params.user.toLowerCase();
  const cur = profiles[u] || {};
  profiles[u] = {
    name: req.body.name != null ? String(req.body.name).slice(0, 40) : cur.name || u,
    status: req.body.status != null ? String(req.body.status).slice(0, 100) : cur.status || '',
    avatarUrl: req.body.avatarUrl != null ? String(req.body.avatarUrl) : cur.avatarUrl || ''
  };
  saveProfiles();
  res.json(profiles[u]);
});
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
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
    } else if (d.type === 'msg' && ws.user && d.to) {
      const to = String(d.to).toLowerCase();
      const m = {
        type: 'msg',
        from: ws.user,
        text: d.text ? String(d.text) : '',
        imageUrl: d.imageUrl ? String(d.imageUrl) : null,
        time: Date.now(),
        id: d.id
      };
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

server.listen(PORT, () => console.log('Server running on port ' + PORT));
