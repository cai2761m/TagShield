# TagShield

一个保守处理 HTML-like 文字的 Obsidian 插件。默认只提示，确认后将 `**在<body>中编写内容**` 修复为 `**在\<body\>中编写内容**`，保留 Markdown 的正常渲染。支持 HTML/XML/JSX/Vue 标签和简单泛型形式；它不会执行标签中的代码，也不发送网络请求。

## 安装

1. 下载或构建本项目，找到 `dist/tag-shield/`。
2. 将里面的 `main.js`、`manifest.json` 和 `styles.css` 放到你的仓库 `<Vault>/.obsidian/plugins/tag-shield/`。使用自定义配置目录时，相应替换 `.obsidian`。
3. 在 Obsidian「设置 → 第三方插件」中启用 **TagShield**。若列表未更新，重启 Obsidian。
4. 用一个测试笔记粘贴 `**在<body>中编写 HTML 的核心内容**`。点击标签下的虚线提示，选择「转义」，检查预览后应用。用 Ctrl/Cmd+Z 验证恢复。

不需要将源代码或 `node_modules` 放入仓库。升级时只替换这三个文件，保留 `data.json` 和 `history/`。

## 功能与用法

- **安全 / 询问（默认）**：编辑或粘贴后约 200ms 检查变动附近；点击虚线标签打开 Quick Fix。可转义、作为行内代码、忽略此项或始终忽略标签类型。
- **仅手动**：关闭实时提示，使用命令面板完成检查与修复。
- **自动保护（主动开启）**：仅处理明确标记为普通文字的下一行，并且候选置信度满足阈值。打开笔记、滚动、Undo/Redo 不触发自动修改。
- **转义方式**：反斜杠 `\<body\>`（默认）、行内代码、实体 `&lt;body&gt;`。只改变标签边界，不重写属性。
- **扫描当前笔记**：按「建议修复 / 需要确认 / 保留真实 HTML / 受保护」分类。批量修复只选择安全项，必须先预览再应用。
- **变更历史**：任何内容修改前保存 SHA-256、逐项变更、前后上下文；手动预览和批量修复保存完整快照。保存失败则不修改笔记。
- **回滚**：支持编辑器一步撤销，以及关闭重开后的持久化回滚。位置变化时只接受唯一内容与上下文匹配。冲突时展示对比；有效快照的整篇强制恢复必须额外勾选确认，当前内容也会先备份。

命令面板输入 `TagShield`：

| 命令 | 用途 |
| --- | --- |
| Escape selected tag / 转义选中标签 | 只检查完整落入选区的标签，预览后修复 |
| Fix current line / 修复当前行 | 检查光标所在行 |
| Scan current note / 扫描当前笔记 | 显式扫描全文，查看分类与批量预览 |
| Review detected issues / 检查问题 | 打开整篇审查列表 |
| Disable for current note / 禁用当前笔记 | 预览并写入 `tagshield: false` |
| Undo last TagShield change / 回滚上次修改 | 检查当前笔记最后一条可恢复记录 |
| Open change history / 打开变更历史 | 查看所有笔记的操作并恢复 |

## 明确表达意图

关闭某篇笔记的实时处理；手动命令仍可运行：

```yaml
---
tagshield: false
---
```

保留整段内容（手动命令也不会处理该区域）：

```md
<!-- tagshield: off -->
这里的标签保持原样。
<!-- tagshield: on -->
```

用 `<!-- tagshield: ignore-next -->` 保留下一个非空行。单实例「忽略」随编辑器会话保留并随位置变化映射；重新打开后需要再次忽略。跨重启忽略请使用上述注释或「始终忽略此类型」。指令应各自独占一行。

自动模式需要明确标记下一行为普通文字：

```md
<!-- tagshield: literal -->
HTML 中的<body>标签用于页面正文。
```

这个标记不会越过代码、Frontmatter、禁用区域或真实 HTML 保护。未明确标记的自然语言示例只建议人工修复，降低置信度阈值也不会放宽这条要求。

## 安全边界

- CodeMirror 宿主语法树与增量 Lezer Markdown 树共同判断上下文；不会对全文执行正则替换。
- 不修改 fenced/indented code、inline code、YAML、HTML 块、注释、Markdown 链接和自动链接中的标签。
- 配对 HTML、HTML 容器中的标签、`script/style/iframe` 等有执行语义的标签受到保护。带属性、空元素、闭合标签等至多给出人工建议，不自动改写。
- **独占一行的 `<body>` / `<Component>` 可能被解析为 HTMLBlock，因此也受到保护。** 规格中的「单独组件标为 ambiguous」与「HTMLBlock 一律不修改」存在冲突，此实现选择后者。讨论代码时可直接使用 Markdown 行内代码；正文里的标签可使用 Quick Fix。
- 所有插件内容写入均通过 CodeMirror transaction；不会对当前笔记调用 `vault.modify()`。异步保存后再次核对笔记身份、原文及 IME 状态，防止过期位置覆盖新输入。
- 历史必须开启；默认保留 30 天、最多 100 次操作（先到任一限制即清理）。历史位于插件目录 `history/`，含笔记片段或完整快照，遵循仓库自身的同步与备份策略。
- 文件重命名后，旧记录不会猜测目标路径；恢复原路径后再尝试回滚。日志损坏时跳过该日志，不将其作为恢复依据。
- 对复杂多行标签、复杂 JSX 表达式及泛型嵌套等不保证给出候选。宁可漏报，也不推测意图。仅作用于 Markdown 编辑器，不在阅读视图中改写内容。

## 开发

需要 Node.js 22+（本次使用 Node.js 24）和 npm。

```sh
npm ci
npm run dev          # watch build
npm run check        # strict TypeScript + ESLint + tests + production build
npm run test:browser # Microsoft Edge headless + real CodeMirror integration harness
node scripts/benchmark.mjs
npm run package      # dist/tag-shield + SHA256SUMS.txt
```

浏览器测试默认使用本机 Edge。其他环境可将 `scripts/browser-test.mjs` 的启动配置改为本机 Chromium，或安装 Playwright Chromium 后去掉 `channel`。

源码布局：`src/parser`（分词/转义）、`src/editor`（语法保护、增量编辑、事务）、`src/history`（持久日志/回滚）、`src/ui`（审查/预览/历史）、`src/settings`（配置）。遵循 [官方 Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 的 manifest、严格 TypeScript、esbuild CommonJS 和外部宿主依赖约定；编辑器入口参考 [Obsidian 编辑器扩展文档](https://docs.obsidian.md/Plugins/Editor/Communicating%20with%20editor%20extensions)。

实时只在改动附近 ±2 行或当前可见范围发现候选；Markdown 语法树用 TreeFragment 增量解析，保护指令通过结构节点建立每状态缓存。初次建树及结构变动仍有解析成本，不宣称所有操作恒定时间。全文候选扫描只由用户命令触发。

## 验证范围

自动化覆盖核心规格、安全保护、持久回滚、冲突拒绝、写入失败、输入期间竞态、CodeMirror Undo/Redo；浏览器覆盖真实编辑器、弹窗、移动宽度、模拟重启及自动模式。详见 [验收记录](docs/VALIDATION.md)。
