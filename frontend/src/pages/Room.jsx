import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const MAX_IMAGES = 50;
const MAX_AUDIOS = 20;
const MAX_VIDEOS = 10;

export default function Room() {
  const { id: roomId } = useParams();
  const roomUrl = useMemo(() => `${window.location.origin}/room/${roomId}`, [roomId]);

  const socketRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [peopleHere, setPeopleHere] = useState(1);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [hiddenImageIds, setHiddenImageIds] = useState(() => new Set());
  const [lightboxId, setLightboxId] = useState(null);
  const [audios, setAudios] = useState([]);
  const [hiddenAudioIds, setHiddenAudioIds] = useState(() => new Set());
  const [audioUploading, setAudioUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [audioDurations, setAudioDurations] = useState(() => new Map());
  const [videos, setVideos] = useState([]);
  const [hiddenVideoIds, setHiddenVideoIds] = useState(() => new Set());
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDurations, setVideoDurations] = useState(() => new Map());
  const [toastOpen, setToastOpen] = useState(false);
  const [toastFading, setToastFading] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimersRef = useRef({ fade: null, hide: null });
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const showToast = (message) => {
    if (!message) return;
    setToastMessage(message);
    const timers = toastTimersRef.current;
    if (timers.fade) clearTimeout(timers.fade);
    if (timers.hide) clearTimeout(timers.hide);

    setToastOpen(true);
    setToastFading(false);

    timers.fade = setTimeout(() => setToastFading(true), 2700);
    timers.hide = setTimeout(() => {
      setToastOpen(false);
      setToastFading(false);
    }, 3000);
  };

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ["websocket"],
    });
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoomText = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      setText(payload.text ?? "");
    };
    const onRoomUsers = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      if (typeof payload.count === "number") setPeopleHere(payload.count);
    };
    const onRoomImages = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const next = Array.isArray(payload.images) ? payload.images : [];
      setImages(next.slice(-MAX_IMAGES));
    };
    const onRoomAudios = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const next = Array.isArray(payload.audios) ? payload.audios : [];
      setAudios(next.slice(-MAX_AUDIOS));
    };
    const onRoomVideos = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const next = Array.isArray(payload.videos) ? payload.videos : [];
      setVideos(next.slice(-MAX_VIDEOS));
    };
    const onRoomImage = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      if (typeof payload.id !== "string") return;
      if (typeof payload.url !== "string") return;

      setImages((prev) => {
        const exists = prev.some((x) => x?.id === payload.id);
        if (exists) return prev;

        const overflow = prev.length >= MAX_IMAGES;
        const next = [...prev, payload].slice(-MAX_IMAGES);
        if (overflow) showToast("Oldest image removed to make space");
        return next;
      });
    };
    const onRoomAudio = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      if (typeof payload.id !== "string") return;
      if (typeof payload.url !== "string") return;

      setAudios((prev) => {
        const exists = prev.some((x) => x?.id === payload.id);
        if (exists) return prev;
        return [...prev, payload].slice(-MAX_AUDIOS);
      });
    };
    const onRoomVideo = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      if (typeof payload.id !== "string") return;
      if (typeof payload.url !== "string") return;

      setVideos((prev) => {
        const exists = prev.some((x) => x?.id === payload.id);
        if (exists) return prev;
        return [...prev, payload].slice(-MAX_VIDEOS);
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room-text", onRoomText);
    socket.on("room-users", onRoomUsers);
    socket.on("room-images", onRoomImages);
    socket.on("room-audios", onRoomAudios);
    socket.on("room-videos", onRoomVideos);
    socket.on("room-image", onRoomImage);
    socket.on("room-audio", onRoomAudio);
    socket.on("room-video", onRoomVideo);

    socket.emit("join-room", { roomId });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room-text", onRoomText);
      socket.off("room-users", onRoomUsers);
      socket.off("room-images", onRoomImages);
      socket.off("room-audios", onRoomAudios);
      socket.off("room-videos", onRoomVideos);
      socket.off("room-image", onRoomImage);
      socket.off("room-audio", onRoomAudio);
      socket.off("room-video", onRoomVideo);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      showToast("Link copied to clipboard!");
    } catch {
      // ignore
    }
  };

  const onChange = (e) => {
    const next = e.target.value;
    setText(next);
    socketRef.current?.emit("text-update", { roomId, text: next });
  };

  const uploadImage = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("roomId", roomId);
      form.append("image", file);

      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error("upload failed");
      await res.json();
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const prettyBytes = (bytes) => {
    if (!bytes || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const v = bytes / Math.pow(1024, i);
    return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
  };

  const formatDuration = (s) => {
    if (!Number.isFinite(s) || s <= 0) return "";
    const total = Math.floor(s);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };

  const uploadAudio = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("audio/")) return;

    setAudioUploading(true);
    try {
      const form = new FormData();
      form.append("roomId", roomId);
      form.append("audio", file);

      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error("upload failed");
      await res.json();
    } catch {
      // ignore
    } finally {
      setAudioUploading(false);
    }
  };

  const uploadVideo = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("video/")) return;

    if (file.size > 100 * 1024 * 1024) {
      showToast("Large file — upload may take a moment");
    }

    setVideoUploading(true);
    setVideoProgress(0);

    try {
      const form = new FormData();
      form.append("roomId", roomId);
      form.append("video", file);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${BACKEND_URL}/upload`);

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          setVideoProgress(Math.max(0, Math.min(100, pct)));
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          reject(new Error("upload failed"));
        };
        xhr.onerror = () => reject(new Error("upload failed"));

        xhr.send(form);
      });
    } catch {
      // ignore
    } finally {
      setVideoUploading(false);
      setTimeout(() => setVideoProgress(0), 400);
    }
  };

  const visibleImages = images.filter((img) => img?.id && !hiddenImageIds.has(img.id));
  const activeImage = visibleImages.find((img) => img.id === lightboxId) ?? null;
  const closeLightbox = () => setLightboxId(null);
  const removeLocal = (id) => {
    setHiddenImageIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (lightboxId === id) closeLightbox();
  };

  const visibleAudios = audios.filter((a) => a?.id && !hiddenAudioIds.has(a.id));
  const removeLocalAudio = (id) => {
    setHiddenAudioIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const visibleVideos = videos.filter((v) => v?.id && !hiddenVideoIds.has(v.id));
  const removeLocalVideo = (id) => {
    setHiddenVideoIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!lightboxId) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxId]);

  useEffect(() => {
    return () => {
      const timers = toastTimersRef.current;
      if (timers.fade) clearTimeout(timers.fade);
      if (timers.hide) clearTimeout(timers.hide);
    };
  }, []);

  const onPickImage = () => fileInputRef.current?.click();

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await uploadImage(file);
  };

  const onPickAudio = () => audioInputRef.current?.click();
  const onAudioChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await uploadAudio(file);
  };

  const onPickVideo = () => videoInputRef.current?.click();
  const onVideoChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await uploadVideo(file);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    await uploadImage(file);
  };

  return (
    <div
      className="min-h-screen bg-zinc-950 text-white flex flex-col"
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={onFileChange}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a"
        className="hidden"
        onChange={onAudioChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
        className="hidden"
        onChange={onVideoChange}
      />

      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl bg-zinc-950/90 px-6 py-5 ring-1 ring-white/15 shadow-2xl">
            <div className="text-sm font-semibold text-white">Drop image to upload</div>
            <div className="mt-1 text-xs text-zinc-400">PNG / JPG / GIF / WEBP</div>
          </div>
        </div>
      ) : null}

      {/* NAVBAR */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/75 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-base font-semibold tracking-tight text-white">
              ShareSpace
            </div>

            <div
              className={[
                "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                connected
                  ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
                  : "bg-white/5 text-zinc-300 ring-white/10",
              ].join(" ")}
            >
              <span className={connected ? "text-emerald-300" : "text-zinc-400"}>●</span>
              Live
            </div>

            <div className="hidden sm:inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs ring-1 ring-white/10">
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="text-zinc-200">
                <span className="font-semibold text-white">{peopleHere}</span>{" "}
                {peopleHere === 1 ? "person" : "people"} here
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 hidden md:block">
            <div className="truncate font-mono text-xs text-zinc-400">{roomUrl}</div>
          </div>

          <div className="flex items-center gap-2">
            {/* Image upload button */}
            <button
              type="button"
              onClick={onPickImage}
              disabled={uploading}
              className="inline-flex items-center justify-center rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
              title="Upload image"
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span className="hidden sm:inline">Uploading</span>
                </span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white/90" aria-hidden="true">
                  <path d="M21.44 11.05L12.95 19.54a6 6 0 01-8.49-8.49l8.49-8.49a4 4 0 015.66 5.66l-8.84 8.84a2 2 0 01-2.83-2.83l8.49-8.49" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {/* Audio upload button */}
            <button
              type="button"
              onClick={onPickAudio}
              disabled={audioUploading}
              className="inline-flex items-center justify-center rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
              title="Upload audio"
            >
              {audioUploading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span className="hidden sm:inline">Uploading</span>
                </span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white/90" aria-hidden="true">
                  <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 21a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M18 19a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {/* Video upload button */}
            <button
              type="button"
              onClick={onPickVideo}
              disabled={videoUploading}
              className="inline-flex items-center justify-center rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
              title="Upload video"
            >
              {videoUploading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span className="hidden sm:inline">Uploading</span>
                </span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white/90" aria-hidden="true">
                  <path d="M23 7l-7 5 7 5V7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={onCopyLink}
              className="relative inline-flex items-center justify-center rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_18px_40px_rgba(16,185,129,0.20)] transition hover:bg-emerald-300 active:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
            >
              Copy Link
            </button>
          </div>
        </div>

        {/* Video upload progress bar */}
        {videoUploading ? (
          <div className="px-4 pb-3">
            <div className="mx-auto w-full max-w-6xl">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-[width] duration-150"
                  style={{ width: `${videoProgress || 0}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                <div>Uploading video…</div>
                <div>{Math.max(0, Math.min(100, videoProgress || 0))}%</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 mx-auto w-full max-w-6xl px-4 py-4 flex flex-col">
        <div className="flex-1 rounded-2xl bg-[#0f0f0f] ring-1 ring-white/10 shadow-2xl overflow-hidden flex flex-col">

          {/* IMAGES SECTION */}
          {visibleImages.length ? (
            <div className="border-b border-white/5 bg-white/[0.02] px-4 sm:px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold tracking-wide text-zinc-300">Images</div>
                <div className="text-[11px] text-zinc-500 font-mono">{visibleImages.length}/{MAX_IMAGES}</div>
              </div>
              <div className="-mx-4 sm:-mx-5 px-4 sm:px-5">
                <div className="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {visibleImages.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setLightboxId(img.id)}
                      className="group relative shrink-0 animate-fadeInUp"
                      title={img?.name || "image"}
                    >
                      <img
                        src={`${BACKEND_URL}${img.url}`}
                        alt={img?.name || "Shared"}
                        className="h-[200px] w-auto max-w-[320px] rounded-xl ring-1 ring-white/10 shadow-lg object-cover transition group-hover:brightness-110"
                        loading="lazy"
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeLocal(img.id); }}
                        className="absolute right-2 top-2 inline-flex items-center rounded-lg bg-black/55 px-2 py-1 text-xs font-semibold text-white ring-1 ring-white/10 backdrop-blur hover:bg-black/70 active:bg-black/60"
                      >
                        ×
                      </button>
                      <div className="mt-2 max-w-[320px] text-left text-xs">
                        <div className="truncate font-mono text-zinc-300">{img?.name || "image"}</div>
                        <div className="font-mono text-zinc-500">{prettyBytes(img?.size)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* AUDIO SECTION */}
          {visibleAudios.length ? (
            <div className="border-b border-white/5 bg-white/[0.015] px-4 sm:px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold tracking-wide text-zinc-300">Audio</div>
                <div className="text-[11px] text-zinc-500 font-mono">{visibleAudios.length}/{MAX_AUDIOS}</div>
              </div>
              <div className="mt-3 space-y-3">
                {visibleAudios.map((a) => (
                  <div key={a.id} className="animate-fadeInUp rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-start gap-3">
                        <div className="mt-0.5 flex items-end gap-0.5">
                          {Array.from({ length: 10 }).map((_, i) => (
                            <span
                              key={i}
                              className={["w-0.5 rounded-full bg-emerald-300/80 origin-bottom", playingAudioId === a.id ? "animate-wave" : ""].join(" ")}
                              style={{ height: `${6 + (i % 5) * 3}px`, animationDelay: `${i * 90}ms` }}
                            />
                          ))}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-zinc-100 flex items-center gap-2">
                            <span className="text-zinc-300" aria-hidden="true">♪</span>
                            <span className="truncate">{a?.filename || a?.name || "audio"}</span>
                            {audioDurations.get(a.id) ? (
                              <span className="shrink-0 font-mono text-xs text-zinc-500">
                                {formatDuration(audioDurations.get(a.id))}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-zinc-500">{prettyBytes(a?.size)}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLocalAudio(a.id)}
                        className="shrink-0 rounded-lg bg-black/40 px-2 py-1 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-black/55"
                        title="Remove locally"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2">
                      <audio
                        controls
                        src={`${BACKEND_URL}${a.url}`}
                        className="w-full"
                        style={{ colorScheme: "dark" }}
                        onPlay={() => setPlayingAudioId(a.id)}
                        onPause={() => setPlayingAudioId((cur) => (cur === a.id ? null : cur))}
                        onEnded={() => setPlayingAudioId((cur) => (cur === a.id ? null : cur))}
                        onLoadedMetadata={(e) => {
                          const d = e.currentTarget.duration;
                          if (!Number.isFinite(d) || d <= 0) return;
                          setAudioDurations((prev) => {
                            if (prev.get(a.id) === d) return prev;
                            const next = new Map(prev);
                            next.set(a.id, d);
                            return next;
                          });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* VIDEOS SECTION */}
          {visibleVideos.length ? (
            <div className="border-b border-white/5 bg-white/[0.01] px-4 sm:px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold tracking-wide text-zinc-300">Videos</div>
                <div className="text-[11px] text-zinc-500 font-mono">{visibleVideos.length}/{MAX_VIDEOS}</div>
              </div>
              <div className="mt-3 space-y-4">
                {visibleVideos.map((v) => (
                  <div key={v.id} className="animate-fadeInUp rounded-2xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden">
                    <div className="relative">
                      <video
                        controls
                        src={`${BACKEND_URL}${v.url}`}
                        className="block w-full max-h-[400px] bg-black rounded-t-2xl"
                        style={{ colorScheme: "dark" }}
                        onLoadedMetadata={(e) => {
                          const d = e.currentTarget.duration;
                          if (!Number.isFinite(d) || d <= 0) return;
                          setVideoDurations((prev) => {
                            if (prev.get(v.id) === d) return prev;
                            const next = new Map(prev);
                            next.set(v.id, d);
                            return next;
                          });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => removeLocalVideo(v.id)}
                        className="absolute right-2 top-2 rounded-lg bg-black/55 px-2 py-1 text-xs font-semibold text-white ring-1 ring-white/10 backdrop-blur hover:bg-black/70 active:bg-black/60"
                        title="Remove locally"
                      >
                        ×
                      </button>
                    </div>
                    <div className="px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-zinc-100 flex items-center gap-2">
                            <span className="truncate">{v?.filename || v?.name || "video"}</span>
                            {videoDurations.get(v.id) ? (
                              <span className="shrink-0 font-mono text-xs text-zinc-500">
                                {formatDuration(videoDurations.get(v.id))}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-zinc-500">{prettyBytes(v?.size)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* TEXT EDITOR */}
          <textarea
            value={text}
            onChange={onChange}
            spellCheck={false}
            placeholder="Start typing…"
            className="flex-1 w-full resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-6 text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-0"
          />

          {/* BOTTOM BAR */}
          <div className="border-t border-white/5 bg-white/[0.02] px-5 py-2">
            <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
              <div className="min-w-0 truncate font-mono">
                Room: <span className="text-zinc-200">{roomId}</span>
              </div>
              <div className="shrink-0 font-mono">{text.length.toLocaleString()} chars</div>
            </div>
          </div>
        </div>
      </div>

      {/* LIGHTBOX */}
      {activeImage ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 sm:p-8"
          onMouseDown={closeLightbox}
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto h-full max-w-5xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="h-full w-full rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-zinc-200">{activeImage?.name || "image"}</div>
                  <div className="font-mono text-xs text-zinc-500">{prettyBytes(activeImage?.size)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => removeLocal(activeImage.id)}
                    className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/10"
                  >
                    × Remove (local)
                  </button>
                  <button
                    type="button"
                    onClick={closeLightbox}
                    className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 grid place-items-center">
                <img
                  src={`${BACKEND_URL}${activeImage.url}`}
                  alt={activeImage?.name || "Shared"}
                  className="max-h-[75vh] w-auto rounded-xl ring-1 ring-white/10 shadow-xl"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* TOAST */}
      {toastOpen ? (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div
            className={[
              "rounded-xl bg-zinc-900/90 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/10 shadow-2xl backdrop-blur",
              "transition-opacity duration-300",
              toastFading ? "opacity-0" : "opacity-100",
            ].join(" ")}
          >
            {toastMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}