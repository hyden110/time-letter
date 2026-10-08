# apps/admin — 管理后台（占位）

一期技术栈：React + Ant Design（依赖裁决 B1）。

状态：⏸ 视觉层等待设计稿冻结（B2 路径 A）。
后端已提供管理接口：`GET /admin/moderation/queue`、`POST /admin/moderation/records/:id/resolve`、
`POST /admin/moderation/letters/:id/freeze`（开发期用 `x-admin-id` 请求头标识管理员）。

计划：
- Sprint 1.2：对接内容审核队列与冻结操作。
- Sprint 1.3：登录鉴权（替换开发期请求头约定）、系统设置（US-025）。
