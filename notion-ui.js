const path = require("path");
const { chromium } = require("playwright");

const MOD = process.platform === "darwin" ? "Meta" : "Control";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureLoggedIn(page) {
  const current = page.url();
  if (current.includes("/login")) {
    throw new Error("Notion is not logged in. Run with NOTION_HEADLESS=false and log in once.");
  }
}

async function clickNewButton(page) {
  const candidates = [
    page.getByRole("button", { name: /^New$/i }),
    page.getByRole("button", { name: "新建" }),
    page.locator("button:has-text('New')"),
    page.locator("button:has-text('新建')")
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0) {
      await candidate.first().click({ timeout: 10000 });
      return;
    }
  }

  throw new Error('Cannot find "New/新建" button in Notion database page');
}

async function focusAndReplace(locator, text) {
  await locator.click({ timeout: 10000 });
  await locator.press(`${MOD}+A`);
  await locator.type(text, { delay: 5 });
}

async function setTitle(page, title) {
  const candidates = [
    page.locator("[aria-label='Page title']"),
    page.locator("textarea[placeholder='Untitled']"),
    page.locator("div[contenteditable='true'][data-placeholder='Untitled']"),
    page.locator("div[contenteditable='true'][placeholder='Untitled']"),
    page.locator("div[contenteditable='true'][aria-label='标题']"),
    page.locator("textarea[placeholder='无标题']")
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0) {
      await focusAndReplace(candidate.first(), title);
      return;
    }
  }

  // Best effort fallback: title is usually focused right after creating a page.
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.type(title, { delay: 5 });
}

async function appendBody(page, text) {
  const candidates = [
    page.locator("main [contenteditable='true']"),
    page.locator("div.notion-page-content [contenteditable='true']")
  ];

  for (const candidate of candidates) {
    const count = await candidate.count();
    if (count > 0) {
      const editable = candidate.nth(Math.max(0, count - 1));
      await editable.click({ timeout: 10000 });
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(text, { delay: 2 });
      return;
    }
  }

  // Fallback: try keyboard-only input.
  await page.keyboard.press("Tab");
  await page.keyboard.type(text, { delay: 2 });
}

function renderBody(note) {
  const lines = [
    `SourceId: ${note.sourceId}`,
    `SourceType: ${note.sourceType}`,
    `Score: ${note.score}`,
    `SyncedAt: ${note.syncedAt}`,
    "",
    note.content || ""
  ];
  return lines.join("\n").slice(0, 12000);
}

async function createPage(page, databaseUrl, note) {
  await page.goto(databaseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureLoggedIn(page);
  await clickNewButton(page);
  await sleep(1200);
  await setTitle(page, note.title.slice(0, 200));
  await appendBody(page, renderBody(note));
  await sleep(500);
  return page.url();
}

async function updatePage(page, pageUrl, note) {
  if (!pageUrl) return { ok: false, pageUrl: "" };

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureLoggedIn(page);
    await setTitle(page, note.title.slice(0, 200));
    await appendBody(page, `\n[Auto update]\n${renderBody(note)}`);
    await sleep(300);
    return { ok: true, pageUrl: page.url() };
  } catch (error) {
    return { ok: false, pageUrl: "" };
  }
}

async function syncNotesViaUI({ databaseUrl, notes, stateBySourceId = {}, headless = false }) {
  const profileDir = process.env.NOTION_PROFILE_DIR || ".playwright-notion";
  const userDataDir = path.isAbsolute(profileDir)
    ? profileDir
    : path.resolve(process.cwd(), profileDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless
  });

  const page = context.pages()[0] || (await context.newPage());
  const results = [];

  try {
    await page.goto(databaseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureLoggedIn(page);

    for (const note of notes) {
      const prev = stateBySourceId[note.sourceId] || {};
      let mode = "created";
      let pageUrl = "";

      if (prev.pageUrl) {
        const updated = await updatePage(page, prev.pageUrl, note);
        if (updated.ok) {
          mode = "updated";
          pageUrl = updated.pageUrl;
        }
      }

      if (!pageUrl) {
        pageUrl = await createPage(page, databaseUrl, note);
      }

      results.push({
        sourceId: note.sourceId,
        mode,
        pageUrl
      });
    }
  } finally {
    await context.close();
  }

  return results;
}

module.exports = {
  syncNotesViaUI
};
