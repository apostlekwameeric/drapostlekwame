"use client";

import BrandMark from "@/components/BrandMark";
import { recallName, rememberName, saveIdentity } from "@/lib/identity";
import { useBrand, type BrandInfo } from "@/lib/useBrand";
import type { StreamSummary } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function HomeScreen({ initialBrand }: { initialBrand: BrandInfo }) {
  const router = useRouter();
  const [live, setLive] = useState<StreamSummary[]>([]);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"video" | "audio">("video");
  const [tagline, setTagline] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { brand } = useBrand(initialBrand);

  useEffect(() => {
    const stored = recallName();
    if (stored) queueMicrotask(() => setName(stored));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        await fetch("/api/streams", { method: "PATCH" });
        const res = await fetch("/api/streams", { cache: "no-store" });
        const data = (await res.json()) as { streams: StreamSummary[] };
        if (alive) setLive(data.streams ?? []);
      } catch {
        /* ignore */
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const goLive = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostName: name, title, mode, tagline, scheduledFor }),
      });
      const data = (await res.json()) as {
        code: string;
        participantId: number;
        token: string;
        name: string;
      };
      if (!res.ok) throw new Error("failed");
      rememberName(data.name);
      saveIdentity({
        code: data.code,
        participantId: data.participantId,
        token: data.token,
        name: data.name,
        role: "host",
      });
      router.push(`/live/${data.code}`);
    } catch {
      setError("Could not start the live. Try again.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-white">
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-3">
          <BrandMark brand={brand} size="md" />
          <div className="flex items-center gap-2">
            <a
              href="/admin"
              className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
              title="Admin dashboard (PIN required)"
            >
              🔐 Admin
            </a>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())}
              placeholder="room code"
              className="w-28 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-xs outline-none focus:border-fuchsia-400"
            />
            <button
              onClick={() => joinCode && router.push(`/live/${joinCode}`)}
              className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/20"
            >
              Join
            </button>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="text-4xl font-black leading-tight sm:text-5xl">
              {brand.name}
              <br />
              <span className="bg-gradient-to-r from-amber-300 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
                {brand.tagline}
              </span>
            </h1>
            <p className="mt-4 max-w-md text-sm text-white/60">
              Broadcast your service, prayer meeting or teaching in video or audio, share
              the invite link, and let members request to come on with their camera or
              just their voice. Everyone can comment in real time while you stream.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-white/70">
              <li>🖼️ Upload a program banner before you start</li>
              <li>📹 Host with video or audio-only</li>
              <li>🎥 Pick front, back or any connected camera</li>
              <li>🔦 Camera light for evening services</li>
              <li>🔗 Invite link + room code</li>
              <li>✋ Viewers request the stage, you approve</li>
              <li>💬 Live comments and reactions</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-bold">Start a live service</h2>
            <p className="mt-1 text-xs text-white/50">
              You will land backstage first to upload your banner and invite people.
            </p>
            <div className="mt-4 space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={32}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-fuchsia-400"
              />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Live title (optional)"
                maxLength={80}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-fuchsia-400"
              />
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Tagline (optional)"
                maxLength={120}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-fuchsia-400"
              />
              <input
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                placeholder="Starts at (e.g. Tonight 8PM)"
                maxLength={60}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm outline-none focus:border-fuchsia-400"
              />
              <div className="grid grid-cols-2 gap-2">
                {(["video", "audio"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setMode(option)}
                    className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                      mode === option
                        ? "border-fuchsia-400 bg-fuchsia-500/20"
                        : "border-white/15 bg-black/30 text-white/60"
                    }`}
                  >
                    {option === "video" ? "📹 Video live" : "🎙️ Audio live"}
                  </button>
                ))}
              </div>
              {error && <p className="text-xs text-rose-300">{error}</p>}
              <button
                onClick={goLive}
                disabled={busy}
                className="w-full rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-500 py-3 text-sm font-bold disabled:opacity-50"
              >
                {busy ? "Opening room…" : "Create live room"}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-white/60">
              Live right now
            </h2>
          </div>
          {live.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/40">
              Nobody is live yet. Be the first!
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((s) => (
                <button
                  key={s.code}
                  onClick={() => router.push(`/live/${s.code}`)}
                  className="group overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-800 to-black text-left transition hover:border-fuchsia-400/60"
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-black/40">
                    {s.hasCover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/streams/${s.code}/cover?v=${s.coverVersion}`}
                        alt=""
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_30%,rgba(217,70,239,0.35),transparent_60%)] text-3xl">
                        {s.mode === "video" ? "📹" : "🎙️"}
                      </div>
                    )}
                    <span
                      className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        s.phase === "onair" ? "bg-rose-600" : "bg-violet-600"
                      }`}
                    >
                      {s.phase === "onair" ? "live" : "soon"}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="truncate font-semibold">{s.title}</p>
                    <p className="mt-1 text-xs text-white/50">
                      {s.hostName} ·{" "}
                      {s.phase === "onair"
                        ? `${s.viewers} watching · ${s.onStage} on stage`
                        : (s.scheduledFor ?? `${s.viewers} waiting`)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

    </main>
  );
}
