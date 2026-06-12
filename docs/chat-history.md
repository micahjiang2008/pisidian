# Pisidian 插件开发对话记录

## 初始化项目
初始化了一个 Obsidian Svelte + Tailwind 插件项目，包含：
- esbuild + esbuild-svelte 打包
- Tailwind CSS v3 + PostCSS
- Obsidian 插件骨架（manifest.json, main.ts, 设置面板, ItemView）
- Svelte 5 组件（App.svelte）

## 样式调试
- `.pisidian-wrapper` 添加蓝色边框，但 `@layer base` 导致 CSS Cascade Layer 优先级问题，Obsidian 的非 layer 样式覆盖了插件样式
- 修复：去掉 `@layer base`，改用普通选择器
- 边框仍然不显示，发现 Svelte 模板中有内联 `border-b` 类与 `styles.css` 冲突
- 修复：删掉模板中的内联边框类

## 布局调整
- 添加 `margin: 0; padding: 0` 消除 `.pisidian-wrapper` 的间距
- 确认 Obsidian 侧边栏自带 padding，不属于插件控制
- 重构为上中下三部分：header / content / footer
- flex 布局：header 和 footer `flex-shrink: 0`，content `flex: 1; overflow-y: auto`
- 添加 `.pisidian-view-content` 和 `.pisidian-settings` 的 `height: 100%` 确保撑满父容器
- header/content/footer 分别加上红/绿/橙色边框用于调试
- 移除 footer 的 `padding: 8px`

## MessageEditor 移植
从 `D:\MYWORK\pi-desktop\ob\` 移植了完整的 MessageEditor：
- `types.ts` — Attachment, SelectOption, ModelProviderOption, SlashCommandOption
- `AttachmentTile.svelte` — 附件卡片（图片预览/文件图标，可删除）
- `AttachmentList.svelte` — 附件列表
- `ModelSelector.svelte` — 模型选择器
- `LevelSelector.svelte` — 推理强度选择器
- `SlashCommandMenu.svelte` — 斜杠命令菜单
- `MessageEditor.svelte` — 主编辑器组件（textarea + 附件 + 工具栏）
- 适配了 Obsidian CSS 变量（`var(--text-normal)`, `var(--background-modifier-border)` 等）

MessageEditor 功能：
- Shift+Enter 发送
- Esc 停止生成
- 拖拽/粘贴/按钮添加附件（jpg/png/txt/md）
- `/` 触发命令菜单
- 模型和推理等级选择
- 自动调整 textarea 高度

## UI 优化
- 上传按钮改小：`width: 22px; height: 22px; padding: 0`，无边框，hover 亮起
- textarea 字号 13px，padding 缩减
- 去掉 textarea 的 focus 边框（`outline: none !important` 等）
- 模型/推理选择器默认文字颜色改为 `var(--text-muted)`

## 自定义下拉菜单
用 div + JavaScript 实现了自定义 SelectDropdown，代替原生 `<select>`：
- `SelectDropdown.svelte` — 通用下拉组件
  - trigger 按钮显示当前值或 placeholder
  - dropdown 面板 `border-radius: 8px`（与 MessageEditor 一致）
  - 支持分组显示（provider 分组）
  - 点击外部关闭
  - Escape 键关闭
  - 箭头旋转动画
- 模型选择器保留 provider 分组
- 推理选择器 placeholder 显示"关闭"
