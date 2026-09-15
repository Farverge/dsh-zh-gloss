# 0.1.6-alpha.1 词典校准报告（2026-09-15 · v0.4.8）

数据源：生产内层 `~/.dsh/profiles/web/node_modules/`（0.1.6-alpha.1 构建产物）。
工具：`tools/scan-locale-gaps.mjs`（键级缺口）+ `tools/check-literal-liveness.mjs`（词条存活性，本次新增）。
报告：`reports/value-gaps-016.md`、`reports/liveness-016.md`。

## 一、官方 i18n 扩张面（让位项）

0.1.6 官方 zh 词典在**键级已全覆盖**（扫描 0 条"键缺失"；剩余 32 条为 zh==en 占位未译，其中多数是单位/格式名/URL，保留不译）。以下官方已内置、插件词条全部让位删除：

- 轨迹徽章 kind.*（用户/助手/工具/子工具/已压缩）——20-trajectory.json 37/42 条字面量让位，文件清空至仅 1 条回执模式；
- Turn/Step/Request 标签 i18n 化（第 {turn} 轮/第 {step} 步/请求 #{request}）——4 条 patterns 删除；
- enter 行为设置迁移到 conversation ns 且全译（排队发送/插话发送）——ui.json 2 条孤儿键删除；
- @会话引用 reference ns 全译——candidate.session 删除；
- /命令目录 command ns 全译（6 条内置命令描述）——backend-copy 6 条删除；
- 权限预设 permission.access 全译（仅可查看/工作区内修改/完全权限 + 确认对话框）——backend-copy 5 条删除，预设名 3 条改对齐官方译法保留（防后端残留面）；
- 图片查看 image.openOriginal=查看原图——"Open image" 删除。

## 二、插件侧缺口（补录项）

- ui.json +4：trajectory.tab.schema=结构（唯一未译 tab）、skill.row.title=技能、plan.chip.label=计划、subagent-model-selection 命名空间 subagentModelSelectionTitle=子智能体（注意：卡片专属 ns，非 settings.plugins）；
- pluginInfo 大规模漂移：0.1.6 loader 注册表 18 个 id 改名（如 permission-presets→permission、web-app→web-runtime）、21 个下线、44 个新写（含 Web 终端/归档会话/排程/PTC/主题 SDK 等）；总计 180 条 = 注册表 164 id ∪ Agent 预设组合行（35 id，persona/present/持久终端等）+ 2 包名别名。

## 三、代码适配（超出"零代码"预期的部分）

须知判定"零代码适配"仅对 monkey-patch 面成立（client-locale 运行时字节级一致，已复核）。但 0.1.6 的**插件列表改版**（ui-settings-plugin-inventory：按 Agent 预设分组的详情行）使旧注入锚点失效，需要：

- client.js 新增 0.1.6 注入路径：锚点=详情 dl 的 完整名称/Module 格 → 键解析顺序 [行内 code 预设条目 id, $pkgAliases[包名], 包名, 包名尾段]（同包多 id 行如 tool-subagent/fork/codex 靠预设条目 id 区分）；克隆格子 div 插入保持 dl 网格；旧路径（≤0.1.5 卡片）保留兜底；
- 词典内嵌 `$pkgAliases`（包名→条目 id，172 条，首见优先）——放在 pluginInfo 内部以兼容运行中的旧宿主代码（热生效，无需重启）；
- 卸载清理修复（存量 bug）：描述 dd 此前不带标记，卸载会残留——现 dt/dd 双标记 + 空格子回收。

## 四、验收

- 离线自测 135/135（新增 B4a6 组 9 项覆盖 0.1.6 详情行 DOM）；
- 真实浏览器模拟推演 43/43（新增 S17 组 5 项）；
- 生产 3080：data-slot-error=0；新 UI（Web 终端/归档会话）官方 zh 完整；词典热生效。
- **注意**：client.js 的生效受官方 bundle 缓存约束——rev 哈希在服务端启动时构建，浏览器按 immutable 缓存一年；新注入代码需**后端重启后刷新页面**才下发（词典无此约束）。已按须知"落文件等自然重启"处理，未动运行中的后端。

## 五、遗留观察项

- settings.models customRoute="Provider ID" 等占位由既有字面量"Provider ID"→供应商 ID 覆盖，维持不动；
- 官方占位未译剩余 32 条多为单位（tok/K/M/px）与格式名（JSON/HTML/PDF），判定不译；
- 预设分组节点（planning/compaction/delegation）不渲染为卡片，不收录。
