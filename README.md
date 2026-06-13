# Pisidian

在 Obsidian 中与 AI 对话的插件，基于 Svelte 5 + Tailwind CSS 构建。

## 功能

- **AI 对话界面** — 独立的侧边栏视图，与 AI 实时对话
- **模型选择** — 支持切换多种 AI 模型，按提供商分组
- **推理强度** — 可调节推理等级
- **附件上传** — 拖拽/粘贴/按钮添加图片和文本文件（jpg、png、txt、md）
- **斜杠命令** — `/` 触发命令菜单，快捷操作
- **设置面板** — 在 Obsidian 设置中配置插件选项

## 开发

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 构建
npm run build
```

## 安装

### 从 Release 安装

1. 下载最新 [Release](https://github.com/micahjiang2008/pisidian/releases) 中的 `main.js`、`styles.css`、`manifest.json`
2. 放入 Vault 的 `.obsidian/plugins/pisidian/` 目录
3. 在 Obsidian 设置中启用插件

### 从源码构建

```bash
git clone https://github.com/micahjiang2008/pisidian.git
cd pisidian
npm install
npm run build
```

然后将 `main.js`、`styles.css`、`manifest.json` 放入 `.obsidian/plugins/pisidian/`。

## 技术栈

- [Svelte 5](https://svelte.dev/)
- [Tailwind CSS v3](https://tailwindcss.com/)
- [esbuild](https://esbuild.github.io/)
- [Obsidian Plugin API](https://docs.obsidian.md/)
