"use client";

import type {
  Identity,
  IncomingSignal,
  MediaKind,
  PublicMessage,
  PublicParticipant,
  StreamSummary,
} from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

type OutSignal = {
  toId: number;
  kind: "offer" | "answer" | "ice" | "bye";
  epoch: number;
  payload: Record<string, unknown>;
};

type Peer = {
  pc: RTCPeerConnection;
  key: string;
  pendingIce: RTCIceCandidateInit[];
  remoteReady: boolean;
};

const onStage = (p: { role: string }) => p.role === "host" || p.role === "guest";

export type Facing = "user" | "environment";

export type CameraOption = {
  deviceId: string;
  label: string;
  facing: Facing | "unknown";
};

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

function guessFacing(label: string): Facing | "unknown" {
  const l = label.toLowerCase();
  if (/(back|rear|environment|world|traseira|arrière)/.test(l)) return "environment";
  if (/(front|user|face|selfie|frontal)/.test(l)) return "user";
  return "unknown";
}

function isEvening(date = new Date()) {
  const hour = date.getHours();
  return hour >= 17 || hour < 7;
}

export type LiveRoomState = {
  ready: boolean;
  stream: StreamSummary | null;
  me: PublicParticipant | null;
  participants: PublicParticipant[];
  messages: PublicMessage[];
  remoteStreams: Record<number, MediaStream>;
  localStream: MediaStream | null;
  cameras: CameraOption[];
  activeCameraId: string | null;
  activeFacing: Facing | "unknown";
  torchSupported: boolean;
  torchOn: boolean;
  autoLight: boolean;
  switchingCamera: boolean;
  mediaError: string | null;
  fatal: string | null;
  connections: Record<number, string>;
};

export function useLiveRoom(identity: Identity | null) {
  const [state, setState] = useState<LiveRoomState>({
    ready: false,
    stream: null,
    me: null,
    participants: [],
    messages: [],
    remoteStreams: {},
    localStream: null,
    cameras: [],
    activeCameraId: null,
    activeFacing: "unknown",
    torchSupported: false,
    torchOn: false,
    autoLight: true,
    switchingCamera: false,
    mediaError: null,
    fatal: null,
    connections: {},
  });

  const identityRef = useRef<Identity | null>(identity);
  identityRef.current = identity;

  const peersRef = useRef(new Map<number, Peer>());
  const orphanIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const queueRef = useRef<OutSignal[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localKindRef = useRef<MediaKind>("none");
  const myEpochRef = useRef(1);
  const meRef = useRef<PublicParticipant | null>(null);
  const peopleRef = useRef<PublicParticipant[]>([]);
  const lastMsgIdRef = useRef(0);
  const stoppedRef = useRef(false);
  const gumBusyRef = useRef(false);
  const phaseRef = useRef<"prelive" | "onair">("prelive");
  const desiredCamRef = useRef<{ deviceId: string | null; facing: Facing }>({
    deviceId: null,
    facing: "user",
  });
  const torchWantedRef = useRef(false);
  const autoLightRef = useRef(true);
  const pendingToggleRef = useRef<{ micOn?: boolean; camOn?: boolean; at: number } | null>(
    null,
  );

  /* ---------------------------------------------------------------- utils */

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const id = identityRef.current;
    if (!id) return null;
    try {
      const res = await fetch(`/api/streams/${id.code}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: id.token, ...payload }),
      });
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, []);

  const flushSignals = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0, queueRef.current.length);
    await post({ action: "signal", signals: batch });
  }, [post]);

  const enqueue = useCallback((sig: OutSignal) => {
    queueRef.current.push(sig);
  }, []);

  const setConn = useCallback((peerId: number, status: string) => {
    setState((prev) => ({
      ...prev,
      connections: { ...prev.connections, [peerId]: status },
    }));
  }, []);

  const dropPeer = useCallback((peerId: number) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      try {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      } catch {
        /* noop */
      }
      peersRef.current.delete(peerId);
    }
    setState((prev) => {
      if (!(peerId in prev.remoteStreams) && !(peerId in prev.connections)) return prev;
      const remoteStreams = { ...prev.remoteStreams };
      const connections = { ...prev.connections };
      delete remoteStreams[peerId];
      delete connections[peerId];
      return { ...prev, remoteStreams, connections };
    });
  }, []);

  /* ------------------------------------------------------------- cameras */

  const videoConstraints = useCallback((): MediaTrackConstraints => {
    const { deviceId, facing } = desiredCamRef.current;
    const base: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    };
    return deviceId
      ? { ...base, deviceId: { exact: deviceId } }
      : { ...base, facingMode: { ideal: facing } };
  }, []);

  const refreshCameras = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams: CameraOption[] = all
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
          facing: guessFacing(d.label),
        }));
      setState((prev) => ({ ...prev, cameras: cams }));
      return cams;
    } catch {
      return [] as CameraOption[];
    }
  }, []);

  /** Read torch capability of the live video track and re-apply the wanted state. */
  const syncTorch = useCallback(async () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) {
      setState((prev) => ({ ...prev, torchSupported: false, torchOn: false }));
      return;
    }
    const settings = track.getSettings?.() ?? {};
    const caps: TorchCapabilities | undefined = track.getCapabilities?.();
    const supported = Boolean(caps?.torch);
    const facing = (settings.facingMode as Facing | undefined) ?? "unknown";

    setState((prev) => ({
      ...prev,
      torchSupported: supported,
      activeCameraId: (settings.deviceId as string | undefined) ?? prev.activeCameraId,
      activeFacing: facing,
    }));

    if (!supported) {
      setState((prev) => ({ ...prev, torchOn: false }));
      return;
    }

    // Evening auto-light: keep the lamp on when using a torch-capable camera.
    const want =
      torchWantedRef.current || (autoLightRef.current && isEvening() ? true : false);
    if (!want) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: true } as unknown as MediaTrackConstraintSet],
      });
      torchWantedRef.current = true;
      setState((prev) => ({ ...prev, torchOn: true }));
    } catch {
      setState((prev) => ({ ...prev, torchOn: false }));
    }
  }, []);

  /* -------------------------------------------------------- local capture */

  const ensureLocalMedia = useCallback(async (want: MediaKind) => {
    if (want === localKindRef.current || gumBusyRef.current) return;
    gumBusyRef.current = true;
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      localKindRef.current = want;
      if (want === "none") {
        setState((prev) => ({ ...prev, localStream: null, mediaError: null }));
        return;
      }
      const constraints: MediaStreamConstraints =
        want === "video"
          ? {
              audio: { echoCancellation: true, noiseSuppression: true },
              video: videoConstraints(),
            }
          : { audio: { echoCancellation: true, noiseSuppression: true }, video: false };
      const media = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = media;
      const me = meRef.current;
      if (me) {
        media.getAudioTracks().forEach((t) => (t.enabled = me.micOn));
        media.getVideoTracks().forEach((t) => (t.enabled = me.camOn));
      }
      setState((prev) => ({ ...prev, localStream: media, mediaError: null }));
      if (want === "video") {
        void refreshCameras();
        void syncTorch();
      } else {
        setState((prev) => ({ ...prev, torchSupported: false, torchOn: false }));
      }
      // Our tracks arrived after some peers were already negotiated: ask them to
      // rebuild the connection so the new tracks are actually published.
      for (const peerId of Array.from(peersRef.current.keys())) {
        enqueue({ toId: peerId, kind: "bye", epoch: myEpochRef.current, payload: {} });
        dropPeer(peerId);
      }
    } catch (err) {
      localKindRef.current = "none";
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera / microphone permission was blocked. Allow access and try again."
          : "Could not start your camera or microphone on this device.";
      setState((prev) => ({ ...prev, mediaError: msg, localStream: null }));
    } finally {
      gumBusyRef.current = false;
    }
  }, [dropPeer, enqueue, refreshCameras, syncTorch, videoConstraints]);

  /* ------------------------------------------------------------ webrtc io */

  const attachLocalTracks = useCallback(async (pc: RTCPeerConnection) => {
    const local = localStreamRef.current;
    if (!local) return;
    for (const track of local.getTracks()) {
      const already = pc.getSenders().some((s) => s.track === track);
      if (already) continue;
      const tx = pc
        .getTransceivers()
        .find((t) => !t.sender.track && t.receiver.track?.kind === track.kind);
      if (tx) {
        try {
          await tx.sender.replaceTrack(track);
          if (tx.direction === "recvonly") tx.direction = "sendrecv";
          else if (tx.direction === "inactive") tx.direction = "sendonly";
        } catch {
          /* noop */
        }
      } else {
        try {
          pc.addTrack(track, local);
        } catch {
          /* noop */
        }
      }
    }
  }, []);

  const buildPeer = useCallback(
    (peerId: number, key: string) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const orphans = orphanIceRef.current.get(`${peerId}:${key}`) ?? [];
      orphanIceRef.current.delete(`${peerId}:${key}`);
      const peer: Peer = { pc, key, pendingIce: orphans, remoteReady: false };
      peersRef.current.set(peerId, peer);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        enqueue({
          toId: peerId,
          kind: "ice",
          epoch: myEpochRef.current,
          payload: { key, candidate: event.candidate.toJSON() },
        });
      };
      pc.ontrack = (event) => {
        const incoming = event.streams[0];
        if (!incoming) return;
        setState((prev) => ({
          ...prev,
          remoteStreams: { ...prev.remoteStreams, [peerId]: incoming },
        }));
      };
      pc.onconnectionstatechange = () => {
        setConn(peerId, pc.connectionState);
        if (pc.connectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            /* noop */
          }
        }
      };
      return peer;
    },
    [enqueue, setConn],
  );

  const startOffer = useCallback(
    async (peerId: number, key: string, peerIsOnStage: boolean) => {
      const peer = buildPeer(peerId, key);
      const { pc } = peer;
      const local = localStreamRef.current;
      if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
      if (peerIsOnStage) {
        const kinds = pc.getTransceivers().map((t) => t.sender.track?.kind);
        if (!kinds.includes("audio")) pc.addTransceiver("audio", { direction: "recvonly" });
        if (!kinds.includes("video")) pc.addTransceiver("video", { direction: "recvonly" });
      }
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        enqueue({
          toId: peerId,
          kind: "offer",
          epoch: myEpochRef.current,
          payload: { key, sdp: pc.localDescription },
        });
      } catch {
        dropPeer(peerId);
      }
    },
    [buildPeer, dropPeer, enqueue],
  );

  const handleSignal = useCallback(
    async (sig: IncomingSignal) => {
      const payload = (sig.payload ?? {}) as Record<string, unknown>;
      const key = typeof payload.key === "string" ? payload.key : "";

      if (sig.kind === "bye") {
        dropPeer(sig.fromId);
        return;
      }

      if (sig.kind === "offer") {
        const sdp = payload.sdp as RTCSessionDescriptionInit | undefined;
        if (!sdp) return;
        const existing = peersRef.current.get(sig.fromId);
        if (existing && existing.key !== key) dropPeer(sig.fromId);
        const peer = peersRef.current.get(sig.fromId) ?? buildPeer(sig.fromId, key);
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          peer.remoteReady = true;
          await attachLocalTracks(peer.pc);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          enqueue({
            toId: sig.fromId,
            kind: "answer",
            epoch: myEpochRef.current,
            payload: { key, sdp: peer.pc.localDescription },
          });
          for (const cand of peer.pendingIce.splice(0)) {
            await peer.pc.addIceCandidate(cand).catch(() => undefined);
          }
        } catch {
          dropPeer(sig.fromId);
        }
        return;
      }

      const peer = peersRef.current.get(sig.fromId);
      if (!peer || (key && peer.key !== key)) {
        // Signals can arrive slightly before the peer object exists; park ICE.
        if (sig.kind === "ice" && key) {
          const bucket = orphanIceRef.current.get(`${sig.fromId}:${key}`) ?? [];
          const cand = (payload.candidate ?? null) as RTCIceCandidateInit | null;
          if (cand && bucket.length < 40) {
            bucket.push(cand);
            orphanIceRef.current.set(`${sig.fromId}:${key}`, bucket);
          }
        }
        return;
      }

      if (sig.kind === "answer") {
        const sdp = payload.sdp as RTCSessionDescriptionInit | undefined;
        if (!sdp) return;
        if (peer.pc.signalingState !== "have-local-offer") return;
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          peer.remoteReady = true;
          for (const cand of peer.pendingIce.splice(0)) {
            await peer.pc.addIceCandidate(cand).catch(() => undefined);
          }
        } catch {
          dropPeer(sig.fromId);
        }
        return;
      }

      if (sig.kind === "ice") {
        const cand = payload.candidate as RTCIceCandidateInit | undefined;
        if (!cand) return;
        if (!peer.remoteReady) {
          peer.pendingIce.push(cand);
          return;
        }
        await peer.pc.addIceCandidate(cand).catch(() => undefined);
      }
    },
    [attachLocalTracks, buildPeer, dropPeer, enqueue],
  );

  /* ------------------------------------------------------------ reconcile */

  const reconcile = useCallback(async () => {
    const me = meRef.current;
    if (!me) return;
    const people = peopleRef.current;
    const live = phaseRef.current === "onair";
    const iAmOnStage = live && onStage(me);

    await ensureLocalMedia(iAmOnStage ? me.media : "none");

    // Backstage: keep the room quiet until the host actually starts the stream.
    if (!live) {
      for (const peerId of Array.from(peersRef.current.keys())) dropPeer(peerId);
      return;
    }

    const wanted = new Set<number>();
    for (const other of people) {
      if (other.id === me.id) continue;
      if (!iAmOnStage && !onStage(other)) continue;
      wanted.add(other.id);
      const key = `${me.id}|${other.id}|${me.epoch}|${other.epoch}`;
      const existing = peersRef.current.get(other.id);
      const iInitiate = me.id > other.id;
      const expectedKey = iInitiate
        ? key
        : `${other.id}|${me.id}|${other.epoch}|${me.epoch}`;

      if (existing) {
        if (existing.key === expectedKey) continue;
        dropPeer(other.id);
      }
      if (iInitiate) {
        await startOffer(other.id, expectedKey, onStage(other));
      }
    }

    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!wanted.has(peerId)) dropPeer(peerId);
    }
    if (orphanIceRef.current.size > 40) orphanIceRef.current.clear();
  }, [dropPeer, ensureLocalMedia, startOffer]);

  /* ----------------------------------------------------------- sync cycle */

  useEffect(() => {
    if (!identity) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stoppedRef.current) return;
      const id = identityRef.current;
      if (!id) return;
      try {
        const res = await fetch(`/api/streams/${id.code}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: id.token,
            sinceMessageId: lastMsgIdRef.current,
          }),
        });
        if (res.status === 401) {
          setState((prev) => ({ ...prev, fatal: "You are no longer in this live." }));
          stoppedRef.current = true;
          return;
        }
        const data = (await res.json()) as {
          stream: StreamSummary;
          me: PublicParticipant;
          participants: PublicParticipant[];
          messages: PublicMessage[];
          signals: IncomingSignal[];
        };

        // Keep a just-issued local mute/camera toggle authoritative for a moment
        // so an in-flight sync response cannot flip the button back.
        const pending = pendingToggleRef.current;
        let mine = data.me;
        if (pending && Date.now() - pending.at < 2500) {
          mine = {
            ...mine,
            ...(typeof pending.micOn === "boolean" ? { micOn: pending.micOn } : {}),
            ...(typeof pending.camOn === "boolean" ? { camOn: pending.camOn } : {}),
          };
        } else if (pending) {
          pendingToggleRef.current = null;
        }

        phaseRef.current = data.stream.phase === "onair" ? "onair" : "prelive";
        meRef.current = mine;
        myEpochRef.current = mine.epoch;
        peopleRef.current = data.participants.map((p) => (p.id === mine.id ? mine : p));

        if (data.messages.length > 0) {
          lastMsgIdRef.current = data.messages[data.messages.length - 1].id;
        }

        setState((prev) => ({
          ...prev,
          ready: true,
          stream: data.stream,
          me: mine,
          participants: peopleRef.current,
          messages:
            data.messages.length > 0
              ? [...prev.messages, ...data.messages].slice(-250)
              : prev.messages,
        }));

        const local = localStreamRef.current;
        if (local) {
          local.getAudioTracks().forEach((t) => (t.enabled = mine.micOn));
          local.getVideoTracks().forEach((t) => (t.enabled = mine.camOn));
        }

        for (const sig of data.signals) {
          await handleSignal(sig);
        }
        await reconcile();
        await flushSignals();
      } catch {
        /* transient network error, keep polling */
      } finally {
        if (!stoppedRef.current) timer = setTimeout(tick, 1100);
      }
    };

    tick();

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [identity, flushSignals, handleSignal, reconcile]);

  /* --------------------------------------------------------- device watch */

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handler = () => void refreshCameras();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [refreshCameras]);

  /* ------------------------------------------------------------- teardown */

  useEffect(() => {
    const peers = peersRef.current;
    return () => {
      stoppedRef.current = true;
      peers.forEach((peer) => {
        try {
          peer.pc.close();
        } catch {
          /* noop */
        }
      });
      peers.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, []);

  /* -------------------------------------------------------------- actions */

  /** Swap the capture device in-place and hot-replace it on every peer. */
  const selectCamera = useCallback(
    async (target: { deviceId?: string | null; facing?: Facing }) => {
      if (localKindRef.current !== "video") {
        desiredCamRef.current = {
          deviceId: target.deviceId ?? null,
          facing: target.facing ?? desiredCamRef.current.facing,
        };
        return;
      }
      setState((prev) => ({ ...prev, switchingCamera: true, mediaError: null }));
      const previous = { ...desiredCamRef.current };
      desiredCamRef.current = {
        deviceId: target.deviceId ?? null,
        facing: target.facing ?? desiredCamRef.current.facing,
      };
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(),
          audio: false,
        });
        const nextTrack = fresh.getVideoTracks()[0];
        if (!nextTrack) throw new Error("no video track");

        const local = localStreamRef.current;
        if (local) {
          const oldTrack = local.getVideoTracks()[0];
          if (oldTrack) {
            local.removeTrack(oldTrack);
            oldTrack.stop();
          }
          nextTrack.enabled = meRef.current?.camOn ?? true;
          local.addTrack(nextTrack);
        } else {
          localStreamRef.current = fresh;
        }

        // Hot swap on every existing connection — no renegotiation required.
        for (const peer of peersRef.current.values()) {
          const sender = peer.pc.getSenders().find((sx) => sx.track?.kind === "video");
          if (sender) await sender.replaceTrack(nextTrack).catch(() => undefined);
        }

        setState((prev) => ({
          ...prev,
          localStream: localStreamRef.current,
          switchingCamera: false,
        }));
        await refreshCameras();
        await syncTorch();
      } catch {
        desiredCamRef.current = previous;
        setState((prev) => ({
          ...prev,
          switchingCamera: false,
          mediaError: "Could not switch to that camera. It may be in use by another app.",
        }));
      }
    },
    [refreshCameras, syncTorch, videoConstraints],
  );

  /** Flip between the front and back camera on phones. */
  const flipCamera = useCallback(async () => {
    const cams = await refreshCameras();
    const current = desiredCamRef.current;
    const currentFacing =
      cams.find((c) => c.deviceId === current.deviceId)?.facing ?? current.facing;
    const nextFacing: Facing = currentFacing === "environment" ? "user" : "environment";
    const match = cams.find((c) => c.facing === nextFacing);
    await selectCamera({ deviceId: match?.deviceId ?? null, facing: nextFacing });
  }, [refreshCameras, selectCamera]);

  /** Turn the device lamp on/off for evening streams. */
  const setTorch = useCallback(async (on: boolean) => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    const caps: TorchCapabilities | undefined = track.getCapabilities?.();
    if (!caps?.torch) {
      setState((prev) => ({ ...prev, torchSupported: false, torchOn: false }));
      return false;
    }
    try {
      await track.applyConstraints({
        advanced: [{ torch: on } as unknown as MediaTrackConstraintSet],
      });
      torchWantedRef.current = on;
      if (!on) autoLightRef.current = false;
      setState((prev) => ({
        ...prev,
        torchOn: on,
        autoLight: on ? prev.autoLight : false,
      }));
      return true;
    } catch {
      setState((prev) => ({ ...prev, mediaError: "This camera's light is unavailable." }));
      return false;
    }
  }, []);

  const setAutoLight = useCallback(
    (on: boolean) => {
      autoLightRef.current = on;
      setState((prev) => ({ ...prev, autoLight: on }));
      if (on && isEvening()) void setTorch(true);
    },
    [setTorch],
  );

  const sendChat = useCallback((body: string) => post({ action: "chat", body }), [post]);
  const sendReaction = useCallback(
    (emoji: string) => post({ action: "reaction", emoji }),
    [post],
  );
  const requestStage = useCallback(
    (media: MediaKind) => post({ action: "request-stage", media }),
    [post],
  );
  const cancelRequest = useCallback(() => post({ action: "cancel-request" }), [post]);
  const startStream = useCallback(
    (media: "video" | "audio") => post({ action: "start-stream", media }),
    [post],
  );
  const updateShow = useCallback(
    (patch: { title?: string; tagline?: string; scheduledFor?: string }) =>
      post({ action: "update-show", ...patch }),
    [post],
  );
  const inviteToStage = useCallback(
    (targetId: number) => post({ action: "invite", targetId }),
    [post],
  );
  const acceptInvite = useCallback(
    (media: MediaKind) => post({ action: "accept-invite", media }),
    [post],
  );
  const decide = useCallback(
    (targetId: number, approve: boolean, media?: MediaKind) =>
      post({ action: "decide", targetId, approve, media }),
    [post],
  );
  const removeFromStage = useCallback(
    (targetId: number) => post({ action: "remove-stage", targetId }),
    [post],
  );
  const setMedia = useCallback(
    (media: MediaKind) => post({ action: "set-media", media }),
    [post],
  );
  const toggle = useCallback(
    (patch: { micOn?: boolean; camOn?: boolean }) => {
      const local = localStreamRef.current;
      if (local) {
        if (typeof patch.micOn === "boolean") {
          local.getAudioTracks().forEach((t) => (t.enabled = patch.micOn as boolean));
        }
        if (typeof patch.camOn === "boolean") {
          local.getVideoTracks().forEach((t) => (t.enabled = patch.camOn as boolean));
        }
      }
      pendingToggleRef.current = { ...patch, at: Date.now() };
      if (meRef.current) meRef.current = { ...meRef.current, ...patch };
      setState((prev) => (prev.me ? { ...prev, me: { ...prev.me, ...patch } } : prev));
      return post({ action: "toggle", ...patch });
    },
    [post],
  );
  const leave = useCallback(async () => {
    const peerIds = Array.from(peersRef.current.keys());
    peerIds.forEach((peerId) =>
      queueRef.current.push({
        toId: peerId,
        kind: "bye",
        epoch: myEpochRef.current,
        payload: {},
      }),
    );
    await flushSignals();
    await post({ action: "leave" });
    stoppedRef.current = true;
    peersRef.current.forEach((p) => p.pc.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }, [flushSignals, post]);

  return {
    ...state,
    sendChat,
    sendReaction,
    requestStage,
    cancelRequest,
    selectCamera,
    flipCamera,
    setTorch,
    setAutoLight,
    startStream,
    updateShow,
    inviteToStage,
    acceptInvite,
    decide,
    removeFromStage,
    setMedia,
    toggle,
    leave,
  };
}
