const axios = require("axios");
const crypto = require("crypto");
const { Client } = require("@notionhq/client");

const DEFAULT_GET_API_BASE = "https://open-api.biji.com/getnote/openapi";
const RECALL_PATH = "/knowledge/search/recall";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildRichText(content) {
  if (!content) return [];
  const chunks = [];
  for (let i = 0; i < content.length; i += 1900) {
    chunks.push(content.slice(i, i + 1900));
  }
  return chunks.slice(0, 20).map((chunk) => ({ text: { content: chunk } }));
}

function safeText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parseTopicIds() {
  const topicId = process.env.GET_TOPIC_ID;
  const topicIdsRaw = process.env.GET_TOPIC_IDS;

  if (topicId) {
    return { topic_id: topicId };
  }
  if (topicIdsRaw) {
    const ids = topicIdsRaw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (ids.length > 0) {
      return { topic_ids: ids };
    }
  }
  throw new Error("Missing GET_TOPIC_ID (or GET_TOPIC_IDS)");
}

function parseRecallItems(responseData) {
  if (Array.isArray(responseData?.c?.data)) return responseData.c.data;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.result?.data)) return responseData.result.data;
  return [];
}

function toNotes(rawItems) {
  const dedup = new Map();

  rawItems.forEach((item, idx) => {
    const rawId = safeText(item?.id, `idx-${idx}`);
    const sourceType = safeText(item?.type, "UNKNOWN");
    const sourceId = `${sourceType}:${rawId}`;
    const title = safeText(item?.title, "(Untitled)");
    const content = safeText(item?.content, "");
    const score = Number(item?.score || 0);
    const contentHash = sha256(`${title}\n${content}\n${sourceType}`);
    const note = {
      sourceId,
      sourceType,
      title,
      content,
      score,
      contentHash,
      syncedAt: new Date().toISOString()
    };

    if (!dedup.has(sourceId) || score > dedup.get(sourceId).score) {
      dedup.set(sourceId, note);
    }
  });

  return Array.from(dedup.values());
}

async function fetchGetNotesByRecall() {
  const getApiKey = requiredEnv("GET_API_KEY");
  const apiBase = process.env.GET_API_BASE || DEFAULT_GET_API_BASE;
  const question = process.env.GET_SYNC_QUERY || "请返回最近更新的笔记";
  const topK = Number(process.env.GET_TOP_K || 20);
  const endpoint = `${apiBase}${RECALL_PATH}`;

  const body = {
    question,
    top_k: Number.isFinite(topK) && topK > 0 ? Math.floor(topK) : 20,
    intent_rewrite: false,
    select_matrix: false,
    ...parseTopicIds()
  };

  const response = await axios.post(endpoint, body, {
    timeout: 20000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey}`,
      "X-OAuth-Version": "1"
    }
  });

  const rawItems = parseRecallItems(response.data);
  return toNotes(rawItems);
}

function propType(database, name) {
  return database?.properties?.[name]?.type || null;
}

function readHashFromPage(page) {
  const prop = page?.properties?.ContentHash;
  if (!prop || prop.type !== "rich_text") return "";
  const texts = prop.rich_text || [];
  return texts.map((t) => t.plain_text || "").join("");
}

function buildPageProperties(note, database) {
  const properties = {};

  if (propType(database, "Name") === "title") {
    properties.Name = {
      title: [{ text: { content: note.title.slice(0, 200) } }]
    };
  }
  if (propType(database, "Content") === "rich_text") {
    properties.Content = {
      rich_text: buildRichText(note.content)
    };
  }
  if (propType(database, "SourceId") === "rich_text") {
    properties.SourceId = {
      rich_text: [{ text: { content: note.sourceId } }]
    };
  }
  if (propType(database, "UpdatedAt") === "date") {
    properties.UpdatedAt = {
      date: { start: note.syncedAt }
    };
  }
  if (propType(database, "ContentHash") === "rich_text") {
    properties.ContentHash = {
      rich_text: [{ text: { content: note.contentHash } }]
    };
  }
  if (propType(database, "SourceType") === "rich_text") {
    properties.SourceType = {
      rich_text: [{ text: { content: note.sourceType } }]
    };
  }
  if (propType(database, "Score") === "number") {
    properties.Score = { number: note.score };
  }

  return properties;
}

async function findExistingPageBySourceId(notion, databaseId, sourceId) {
  const resp = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "SourceId",
      rich_text: { equals: sourceId }
    },
    page_size: 1
  });
  return resp.results[0] || null;
}

async function syncToNotion() {
  const notionToken = requiredEnv("NOTION_TOKEN");
  const databaseId = requiredEnv("NOTION_DATABASE_ID");
  const notion = new Client({ auth: notionToken });

  const database = await notion.databases.retrieve({ database_id: databaseId });
  if (propType(database, "SourceId") !== "rich_text") {
    throw new Error('Notion database must contain property "SourceId" (Rich text)');
  }
  if (propType(database, "Name") !== "title") {
    throw new Error('Notion database must contain property "Name" (Title)');
  }

  const notes = await fetchGetNotesByRecall();
  if (!notes.length) {
    console.log("No notes recalled from Get API.");
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const note of notes) {
    try {
      const existing = await findExistingPageBySourceId(notion, databaseId, note.sourceId);
      const properties = buildPageProperties(note, database);

      if (!existing) {
        await notion.pages.create({
          parent: { database_id: databaseId },
          properties
        });
        created += 1;
        continue;
      }

      if (propType(database, "ContentHash") === "rich_text") {
        const oldHash = readHashFromPage(existing);
        if (oldHash && oldHash === note.contentHash) {
          skipped += 1;
          continue;
        }
      }

      await notion.pages.update({
        page_id: existing.id,
        properties
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed syncing note sourceId=${note.sourceId}:`, err.message);
    }
  }

  console.log(
    `Sync done. created=${created}, updated=${updated}, skipped=${skipped}, failed=${failed}, total=${notes.length}`
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

syncToNotion().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
