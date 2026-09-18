export type MediaKind = "video" | "audio" | "none";
export type Role = "host" | "guest" | "viewer";
export type SignalKind = "offer" | "answer" | "ice" | "bye";

export type PublicParticipant = {
  id: number;
  name: string;
  role: Role;
  media: MediaKind;
  epoch: number;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  requestState: "none" | "pending" | "denied" | "invited";
  requestedMedia: MediaKind;
};

export type PublicMessage = {
  id: number;
  name: string;
  body: string;
  kind: "chat" | "system" | "reaction";
  participantId: number | null;
  createdAt: string;
};

export type IncomingSignal = {
  id: number;
  fromId: number;
  toId: number;
  kind: SignalKind;
  epoch: number;
  payload: unknown;
};

export type StreamPhase = "prelive" | "onair";

export type StreamSummary = {
  code: string;
  title: string;
  hostName: string;
  mode: "video" | "audio";
  status: "live" | "ended";
  phase: StreamPhase;
  tagline: string | null;
  scheduledFor: string | null;
  coverVersion: number;
  hasCover: boolean;
  viewers: number;
  onStage: number;
  createdAt: string;
  startedAt: string | null;
};

export type SyncResponse = {
  stream: StreamSummary;
  me: PublicParticipant;
  participants: PublicParticipant[];
  messages: PublicMessage[];
  signals: IncomingSignal[];
  serverTime: string;
};

export type Identity = {
  code: string;
  participantId: number;
  token: string;
  name: string;
  role: Role;
};
