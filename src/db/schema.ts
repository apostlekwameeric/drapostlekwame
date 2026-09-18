import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const brand = pgTable("brand", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default("Apostle Kwame Ministry"),
  tagline: text("tagline").notNull().default("Live Streaming"),
  logoMime: text("logo_mime"),
  logoData: bytea("logo_data"),
  logoVersion: integer("logo_version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const streams = pgTable(
  "streams",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    hostName: text("host_name").notNull(),
    mode: text("mode").notNull().default("video"), // video | audio
    status: text("status").notNull().default("live"), // live | ended
    phase: text("phase").notNull().default("prelive"), // prelive | onair
    tagline: text("tagline"),
    scheduledFor: text("scheduled_for"),
    coverVersion: integer("cover_version").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("streams_code_idx").on(table.code)],
);

export const streamCovers = pgTable("stream_covers", {
  streamId: integer("stream_id")
    .primaryKey()
    .references(() => streams.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participants = pgTable(
  "participants",
  {
    id: serial("id").primaryKey(),
    streamId: integer("stream_id")
      .notNull()
      .references(() => streams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token: text("token").notNull(),
    role: text("role").notNull().default("viewer"), // host | guest | viewer
    media: text("media").notNull().default("none"), // video | audio | none
    requestState: text("request_state").notNull().default("none"), // none | pending | denied
    requestedMedia: text("requested_media").notNull().default("none"),
    epoch: integer("epoch").notNull().default(1),
    micOn: boolean("mic_on").notNull().default(true),
    camOn: boolean("cam_on").notNull().default(true),
    handRaised: boolean("hand_raised").notNull().default(false),
    active: boolean("active").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("participants_stream_idx").on(table.streamId),
    uniqueIndex("participants_token_idx").on(table.token),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    streamId: integer("stream_id")
      .notNull()
      .references(() => streams.id, { onDelete: "cascade" }),
    participantId: integer("participant_id"),
    name: text("name").notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull().default("chat"), // chat | system | reaction
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("messages_stream_idx").on(table.streamId, table.id)],
);

export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    streamId: integer("stream_id")
      .notNull()
      .references(() => streams.id, { onDelete: "cascade" }),
    fromId: integer("from_id").notNull(),
    toId: integer("to_id").notNull(),
    kind: text("kind").notNull(), // offer | answer | ice | bye
    epoch: integer("epoch").notNull().default(1),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("signals_target_idx").on(table.streamId, table.toId)],
);

export type Brand = typeof brand.$inferSelect;
export type Stream = typeof streams.$inferSelect;
export type StreamCover = typeof streamCovers.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Signal = typeof signals.$inferSelect;
