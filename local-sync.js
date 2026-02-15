const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
require("dotenv").config();

const { syncNotesViaUI } = require("./notion-ui");

const DEFAULT_GET_API_BASE = "https://open-api.biji.com/getnote/openapi";
const RECALL_PATH = "/knowledge/search/recall";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function stateFilePath() {
  const configured = process.env.STATE_FILE || ".sync-state.json";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

async function loadState() {
  const filename = stateFilePath();
  try {
    const raw = await fs.readFile(filename, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : { version: 1, notes: {} };
  } catch (_) {
    return { version: 1, notes: {} };
  }
}

async function saveState(state) {
  const filename = stateFilePath();
  const payload = JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      notes: state.notes || {}
    },
    null,
    2
  );
  await fs.writeFile(filename, payload, "utf8");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parseTopicSelector() {
  const topicId = process.env.GET_TOPIC_ID;
  const topicIds = process.env.GET_TOPIC_IDS;

  if (topicId) return { topic_id: topicId };
  if (topicIds) {
    const list = topicIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return { topic_ids: list };
  }
  throw new Error("Missing GET_TOPIC_ID (or GET_TOPIC_IDS)");
}

function parseRecallItems(payload) {
  if (Array.isArray(payload?.c?.data)) return payload.c.data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  return [];
}

function mapNotes(items) {
  const dedup = new Map();
  items.forEach((item, index) => {
    const type = String(item?.type || "UNKNOWN");
    const rawId = String(item?.id || `idx-${index}`);
    const sourceId = `${type}:${rawId}`;
    const title = String(item?.title || "(Untitled)");
    const content = String(item?.content || "");
    const score = Number(item?.score || 0);
    const contentHash = sha256(`${title}\n${content}\n${type}`);
    const syncedAt = new Date().toISOString();
    const note = { sourceId, sourceType: type, title, content, score, contentHash, syncedAt };

    if (!dedup.has(sourceId) || score > dedup.get(sourceId).score) {
      dedup.set(sourceId, note);
    }
  });
  return Array.from(dedup.values());
}

async function fetchFromGet() {
  const apiKey = requiredEnv("GET_API_KEY");
  const apiBase = process.env.GET_API_BASE || DEFAULT_GET_API_BASE;
  const query = process.env.GET_SYNC_QUERY || "请返回最近更新的笔记";
  const topK = toInt(process.env.GET_TOP_K, 50);
  const url = `${apiBase}${RECALL_PATH}`;

  const body = {
    question: query,
    top_k: topK > 0 ? topK : 50,
    intent_rewrite: false,
    select_matrix: false,
    ...parseTopicSelector()
  };

  const response = await axios.post(url, body, {
    timeout: 20000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-OAuth-Version": "1"
    }
  });

  return mapNotes(parseRecallItems(response.data));
}

function pickChanged(notes, stateNotes, limit) {
  const changed = [];
  for (const note of notes) {
    const old = stateNotes[note.sourceId];
    if (!old || old.contentHash !== note.contentHash) {
      changed.push(note);
    }
  }
  return changed.slice(0, limit);
}

async function runOnce() {
  const databaseUrl = requiredEnv("NOTION_DATABASE_URL");
  const headless = toBool(process.env.NOTION_HEADLESS, false);
  const maxSyncPerRun = Math.max(1, toInt(process.env.MAX_SYNC_PER_RUN, 20));

  const state = await loadState();
  state.notes = state.notes || {};

  const allNotes = await fetchFromGet();
  const changedNotes = pickChanged(allNotes, state.notes, maxSyncPerRun);

  if (changedNotes.length === 0) {
    console.log(`[${new Date().toISOString()}] No changed notes.`);
    return;
  }

  console.log(
    `[${new Date().toISOString()}] Sync start: changed=${changedNotes.length}, fetched=${allNotes.length}`
  );

  const results = await syncNotesViaUI({
    databaseUrl,
    notes: changedNotes,
    stateBySourceId: state.notes,
    headless
  });

  results.forEach((result) => {
    const note = changedNotes.find((n) => n.sourceId === result.sourceId);
    if (!note) return;
    state.notes[result.sourceId] = {
      sourceId: note.sourceId,
      title: note.title,
      contentHash: note.contentHash,
      pageUrl: result.pageUrl || state.notes[result.sourceId]?.pageUrl || "",
      lastSyncedAt: new Date().toISOString()
    };
  });

  await saveState(state);
  console.log(
    `[${new Date().toISOString()}] Sync done: created_or_updated=${results.length}, state_file=${stateFilePath()}`
  );
}

async function runWatch() {
  const minutes = Math.max(1, toInt(process.env.SYNC_INTERVAL_MINUTES, 5));
  const intervalMs = minutes * 60 * 1000;
  console.log(`[${new Date().toISOString()}] Watch mode started. interval=${minutes}m`);

  const loop = async () => {
    try {
      await runOnce();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Sync error: ${error.message}`);
    }
  };

  await loop();
  setInterval(loop, intervalMs);
}

async function main() {
  const watch = process.argv.includes("--watch");
  if (watch) {
    await runWatch();
    return;
  }
  await runOnce();
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
