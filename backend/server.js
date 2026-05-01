const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");

const PORT = 3001;
const FRONTEND_ORIGIN = "http://localhost:5173";

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

app.use("/uploads", express.static(uploadsDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    credentials: true,
  },
});

// roomId -> text
const roomText = new Map();
// roomId -> latest image metadata
const roomImages = new Map();
const MAX_IMAGES_PER_ROOM = 50;
// roomId -> audio files (array)
const roomAudios = new Map();
// roomId -> video files (array)
const roomVideos = new Map();
const MAX_VIDEOS_PER_ROOM = 10;

function safeExtFromMime(mime) {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "audio/mpeg":
      return ".mp3";
    case "audio/wav":
      return ".wav";
    case "audio/x-wav":
      return ".wav";
    case "audio/ogg":
      return ".ogg";
    case "audio/mp4":
      return ".m4a";
    case "audio/x-m4a":
      return ".m4a";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    case "video/x-matroska":
      return ".mkv";
    default:
      return "";
  }
}

const allowedMimes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = safeExtFromMime(file.mimetype) || path.extname(file.originalname) || "";
      const base = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      cb(null, `${base}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, allowedMimes.has(file.mimetype));
  },
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

app.post(
  "/upload",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  (req, res) => {
  const roomId = req.body?.roomId;
  if (!roomId || typeof roomId !== "string") {
    return res.status(400).json({ error: "roomId is required" });
  }

  const file =
    req.files?.image?.[0] ||
    req.files?.file?.[0] ||
    req.files?.audio?.[0] ||
    req.files?.video?.[0] ||
    null;
  if (!file) return res.status(400).json({ error: "file is required" });

  const payload = {
    roomId,
    id: file.filename,
    url: `/uploads/${file.filename}`,
    name: file.originalname,
    size: file.size,
  };

  const isAudio = typeof file.mimetype === "string" && file.mimetype.startsWith("audio/");
  if (isAudio) {
    const list = roomAudios.get(roomId) ?? [];
    const next = [...list, payload];
    roomAudios.set(roomId, next);

    io.to(roomId).emit("room-audio", {
      roomId,
      url: payload.url,
      type: "audio",
      filename: payload.name,
      id: payload.id,
      size: payload.size,
    });

    return res.json({
      url: payload.url,
      type: "audio",
      filename: payload.name,
    });
  }

  const isVideo = typeof file.mimetype === "string" && file.mimetype.startsWith("video/");
  if (isVideo) {
    const list = roomVideos.get(roomId) ?? [];
    const next = [...list, payload].slice(-MAX_VIDEOS_PER_ROOM);
    roomVideos.set(roomId, next);

    io.to(roomId).emit("room-video", {
      roomId,
      url: payload.url,
      type: "video",
      filename: payload.name,
      size: payload.size,
      id: payload.id,
    });

    return res.json({
      url: payload.url,
      type: "video",
      filename: payload.name,
      size: payload.size,
    });
  }

  const list = roomImages.get(roomId) ?? [];
  const next = [...list, payload].slice(-MAX_IMAGES_PER_ROOM);
  roomImages.set(roomId, next);

  io.to(roomId).emit("room-image", payload);

  return res.json({
    id: payload.id,
    url: payload.url,
    name: payload.name,
    size: payload.size,
    type: "image",
  });
  },
);

function emitRoomUsers(roomId) {
  io.in(roomId)
    .allSockets()
    .then((sockets) => {
      io.to(roomId).emit("room-users", { roomId, count: sockets.size });
    })
    .catch(() => {});
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId }) => {
    if (!roomId || typeof roomId !== "string") return;

    socket.join(roomId);
    socket.data.roomId = roomId;

    const current = roomText.get(roomId) ?? "";
    socket.emit("room-text", { roomId, text: current });

    const images = roomImages.get(roomId) ?? [];
    socket.emit("room-images", { roomId, images });

    const audios = roomAudios.get(roomId) ?? [];
    socket.emit("room-audios", { roomId, audios });

    const videos = roomVideos.get(roomId) ?? [];
    socket.emit("room-videos", { roomId, videos });

    emitRoomUsers(roomId);
  });

  socket.on("text-update", ({ roomId, text }) => {
    if (!roomId || typeof roomId !== "string") return;
    if (typeof text !== "string") return;

    roomText.set(roomId, text);
    socket.to(roomId).emit("room-text", { roomId, text });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId) emitRoomUsers(roomId);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${PORT}`);
});

