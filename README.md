# Get 笔记自动同步到 Notion

这个仓库提供一个最小可用方案：

- 使用 `sync.js` 从 Get API 拉取笔记
- 按 `SourceId` 在 Notion 数据库中“存在则更新，不存在则创建”
- 用 GitHub Actions 定时执行，无需自建服务器

## 1. 本地初始化

```bash
npm install
```

## 2. 配置 Notion 数据库字段

在你的 Notion Database 中创建以下属性（名称需一致）：

- `Name`（Title）
- `Content`（Rich text）
- `SourceId`（Rich text）
- `UpdatedAt`（Date）

并把该数据库共享给你的 Notion Integration。

## 3. 必填环境变量 / GitHub Secrets

至少配置：

- `GET_API_URL`：Get 笔记接口地址（返回单条对象或数组都可以）
- `GET_API_KEY`：Get API Key
- `NOTION_TOKEN`：Notion Integration Token
- `NOTION_DATABASE_ID`：Notion 数据库 ID

可选：

- `GET_AUTH_HEADER`：鉴权请求头名称，默认 `Authorization`
- `GET_AUTH_SCHEME`：鉴权前缀，默认 `Bearer`。如果你的接口不需要前缀，可设为空字符串。

## 4. GitHub Actions

工作流文件：`.github/workflows/sync.yml`

- 手动触发：Actions -> `Get Notes Sync To Notion` -> Run workflow
- 定时触发：默认每天北京时间 09:00（UTC 01:00）

如需调整时间，修改 cron 表达式即可。

## 5. 本地测试

先在本地导出环境变量，然后运行：

```bash
npm run sync
```

## 6. 数据映射说明

脚本会尽量兼容常见字段名：

- `id/noteId/uuid` -> `SourceId`
- `title/name` -> `Name`
- `content/body/text` -> `Content`
- `updatedAt/updated_at/modifiedAt` -> `UpdatedAt`

如果你的 Get API 字段不同，改 `sync.js` 中的映射函数即可。
