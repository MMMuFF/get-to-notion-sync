const axios = require("axios");
const { Client } = require("@notionhq/client");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeToNotes(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function pick(obj, keys, fallback = "") {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return String(obj[key]);
    }
  }
  return fallback;
}

function buildRichText(content) {
  if (!content) return [];
  // Notion rich_text.content max length is 2000 chars.
  const chunks = [];
  for (let i = 0; i < content.length; i += 1900) {
    chunks.push(content.slice(i, i + 1900));
  }
  return chunks.slice(0, 20).map((chunk) => ({
    text: { content: chunk }
  }));
}

async function findExistingPageBySourceId(notion, databaseId, sourceId) {
  const resp = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "SourceId",
      rich_text: {
        equals: sourceId
      }
    },
    page_size: 1
  });

  return resp.results[0] || null;
}

function buildPageProperties(note) {
  const title = note.title || "(Untitled)";
  const content = note.content || "";
  return {
    Name: {
      title: [{ text: { content: title.slice(0, 200) } }]
    },
    Content: {
      rich_text: buildRichText(content)
    },
    SourceId: {
      rich_text: [{ text: { content: note.sourceId } }]
    },
    UpdatedAt: {
      date: {
        start: note.updatedAt
      }
    }
  };
}

async function fetchGetNotes() {
  const getApiUrl = requiredEnv("GET_API_URL");
  const getApiKey = requiredEnv("GET_API_KEY");
  const authHeader = process.env.GET_AUTH_HEADER || "Authorization";
  const authScheme = process.env.GET_AUTH_SCHEME || "Bearer";

  const headers = {
    [authHeader]: authScheme ? `${authScheme} ${getApiKey}` : getApiKey
  };

  const response = await axios.get(getApiUrl, { headers, timeout: 20000 });
  const rawNotes = normalizeToNotes(response.data);

  return rawNotes.map((item, index) => {
    const sourceId = pick(item, ["id", "noteId", "uuid"], `idx-${index}`);
    const title = pick(item, ["title", "name"], "(Untitled)");
    const content = pick(item, ["content", "body", "text"], "");
    const updatedAt = pick(item, ["updatedAt", "updated_at", "modifiedAt"], new Date().toISOString());
    return { sourceId, title, content, updatedAt };
  });
}

async function syncToNotion() {
  const notionToken = requiredEnv("NOTION_TOKEN");
  const databaseId = requiredEnv("NOTION_DATABASE_ID");
  const notion = new Client({ auth: notionToken });

  const notes = await fetchGetNotes();
  if (!notes.length) {
    console.log("No notes fetched from Get API.");
    return;
  }

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const note of notes) {
    try {
      const existing = await findExistingPageBySourceId(notion, databaseId, note.sourceId);
      const properties = buildPageProperties(note);

      if (existing) {
        await notion.pages.update({
          page_id: existing.id,
          properties
        });
        updated += 1;
      } else {
        await notion.pages.create({
          parent: { database_id: databaseId },
          properties
        });
        created += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`Failed syncing note sourceId=${note.sourceId}`, err.message);
    }
  }

  console.log(`Sync done. created=${created}, updated=${updated}, failed=${failed}, total=${notes.length}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

syncToNotion().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
