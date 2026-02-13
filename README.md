# Get 笔记自动同步到 Notion

这个项目会定时调用 Get 知识库 OpenAPI，把召回结果同步到 Notion 数据库：

- 有同一个 `SourceId`：更新该条记录
- 没有 `SourceId`：创建新记录
- 如果你在 Notion 里加了 `ContentHash` 字段：内容没变会自动跳过更新

## 1. Notion 数据库字段（先建好）

必填字段（名字必须一致）：

- `Name`（Title）
- `SourceId`（Rich text）

建议字段：

- `Content`（Rich text）
- `UpdatedAt`（Date）
- `ContentHash`（Rich text）
- `SourceType`（Rich text）
- `Score`（Number）

并把这个数据库共享给你的 Notion Integration。

## 2. GitHub Secrets（仓库设置里配置）

必填：

- `GET_API_KEY`：Get OpenAPI key
- `GET_TOPIC_ID`：Get 里的 topic_id（API 配置页参数 2）
- `NOTION_TOKEN`：Notion Integration Token
- `NOTION_DATABASE_ID`：Notion 数据库 ID

可选：

- `GET_API_BASE`：默认 `https://open-api.biji.com/getnote/openapi`
- `GET_TOPIC_IDS`：多个 topic，逗号分隔（和 `GET_TOPIC_ID` 二选一）
- `GET_SYNC_QUERY`：召回问题，默认 `请返回最近更新的笔记`
- `GET_TOP_K`：每次召回条数，默认 `20`

## 3. 运行方式

工作流文件：`.github/workflows/sync.yml`

- 手动触发：Actions -> `Get Notes Sync To Notion` -> Run workflow
- 自动触发：默认每小时一次（UTC，每小时第 0 分）

## 4. 本地测试（可选）

```bash
npm install
npm run sync
```

## 5. 说明

当前使用的是 Get 的“召回”接口，它是按 query + topic 返回 top_k 结果，不是官方“全量导出所有笔记”接口。  
如果你想尽量覆盖更多更新，建议把 `GET_SYNC_QUERY` 设得更宽泛，并提高 `GET_TOP_K`。
