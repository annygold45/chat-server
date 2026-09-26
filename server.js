const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: 'zdjkzup9',
  api_key: '393987592711381',
  api_secret: 'ZHqkWKm-yWVlxwyDGvfhAlEJG-A'
});

const PORT = process.env.PORT || 8080;
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.get('/', (req, res) => res.send('Chat server running'));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const isAudio = (req.file.mimetype || '').startsWith('audio');
  const stream = cloudinary.uploader.upload_stream(
    { resource_type: isAudio ? 'video' : 'image', folder: 'chat_uploads' },
    (err, result) => {
      if (err) return res.status(500).json({ error: 'upload failed' });
      res.json({ url: result.secure_url });
    }
  );
  stream.end(req.file.buffer);
});

app.use(express.json());

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users)); }

const tokens = {};

app.post('/register', (req, res) => {
  const u = String(req.body.username || '').toLowerCase().trim();
  const p = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return res.status(400).json({ error: 'invalid username' });
  if (p.length < 4) return res.status(400).json({ error: 'password too short' });
  if (users[u]) return res.status(409).json({ error: 'username taken' });
  users[u] = { hash: bcrypt.hashSync(p, 8) };
  saveUsers();
  const token = crypto.randomBytes(16).toString('hex');
  tokens[token] = u;
  res.json({ token, username: u });
});

app.post('/login', (req, res) => {
  const u = String(req.body.username || '').toLowerCase().trim();
  const p = String(req.body.password || '');
  const rec = users[u];
  if (!rec || !bcrypt.compareSync(p, rec.hash)) return res.status(401).json({ error: 'invalid credentials' });
  const token = crypto.randomBytes(16).toString('hex');
  tokens[token] = u;
  res.json({ token, username: u });
});
const fs = require('fs');
const path = require('path');
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

    if (d.type === 'login' && d.user && d.token) {
      const claimedUser = String(d.user).toLowerCase();
      const tokenUser = tokens[d.token];
      if (!tokenUser || tokenUser !== claimedUser) {
        ws.send(JSON.stringify({ type: 'auth_error' }));
        return;
      }
      ws.user = claimedUser;
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
        audioUrl: d.audioUrl ? String(d.audioUrl) : null,
        replyText: d.replyText ? String(d.replyText) : null,
        replyByMe: !!d.replyByMe,
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
    } else if (d.type === 'delete' && ws.user && d.to && d.id) {
      tell(String(d.to).toLowerCase(), { type: 'delete', from: ws.user, id: d.id });
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
