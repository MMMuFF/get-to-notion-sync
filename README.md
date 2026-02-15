# Get 笔记 -> Notion（本地全自动版）

这个版本不依赖企业 Notion Integration。  
思路是：

- 本地定时调用 Get OpenAPI，拉取最近更新笔记
- 用浏览器自动化（Playwright）把变化内容写入你的 Notion 数据库
- 用本地状态文件去重，避免重复写入

## 一次性准备

1. 安装依赖

```bash
npm install
```

2. 安装浏览器内核（只需一次）

```bash
npm run browser:install
```

3. 复制环境变量模板

```bash
cp .env.example .env
```

4. 编辑 `.env`，至少填这 3 个

- `GET_API_KEY`
- `GET_TOPIC_ID`
- `NOTION_DATABASE_URL`

## 首次登录 Notion（必须）

首次运行请保持 `NOTION_HEADLESS=false`（默认就是 false）：

```bash
npm run local:once
```

会弹出浏览器，请在这个窗口登录 Notion。  
登录成功后脚本会继续执行，同步结果会打印在终端。

## 开启全自动（常驻）

```bash
npm run local:watch
```

- 默认每 5 分钟同步一次（`SYNC_INTERVAL_MINUTES=5`）
- 可在 `.env` 里修改间隔

## 关键配置说明

- `GET_SYNC_QUERY`：召回问题，默认 `请返回最近更新的笔记`
- `GET_TOP_K`：每次召回上限，默认 `50`
- `MAX_SYNC_PER_RUN`：每轮最多处理条数，默认 `20`
- `STATE_FILE`：本地去重状态文件，默认 `.sync-state.json`
- `NOTION_PROFILE_DIR`：浏览器登录态目录，默认 `.playwright-notion`

## 常见问题

1. 为什么 GitHub 邮件还在来？

- 这个项目已移除定时触发（`.github/workflows/sync.yml` 只保留手动触发）
- 你还需要去 GitHub Actions 页面手动 `Disable workflow` 一次

2. 为什么没写入 Notion？

- 先看是否弹出浏览器并完成登录
- 确认 `NOTION_DATABASE_URL` 是数据库视图链接
- 确认该数据库页面你当前账号可编辑

3. 能否做到秒级实时？

- 目前是轮询模式（例如每 5 分钟）
- 想更快可缩短 `SYNC_INTERVAL_MINUTES`，但会增加调用频率
