# Markdown 预览样式调研与候选对比

> 结论先说：**MoDex 有预览样式**。当前默认是 Codex 极简风（单色、发丝线、13.5px/1.75 正文、深/浅主题两套）。
> 预览排版由 `src/renderer/styles.css` 的 `.markdown-body` 规则控制，可以整体替换或抽出多套预设。
> 本文件是「换一个更好看的 Markdown 样式」的调研与候选对比，全部截图都是 **MoDex 真实渲染**（同一份示例文档、同一窗口，仅替换预览区 CSS）。

![Markdown 样式候选总览](markdown-style-gallery.png)

## 1. 调研来源

| 来源 | 借鉴点 |
| --- | --- |
| [sindresorhus/github-markdown-css](https://github.com/sindresorhus/github-markdown-css) | GitHub 官方 Markdown 样式的 CSS 复刻：系统字体、h1/h2 下划线、斑马纹表格、蓝色链接（MIT） |
| [cxwya/markdown-themes](https://github.com/cxwya/markdown-themes) | 30+ 款中文 Markdown 预览主题合集（Typo.css、Vue、Bear、飞书云文档等），适合找「中文排版」参考 |
| [wenbingyin/typora-vue-theme](https://github.com/wenbingyin/typora-vue-theme) | Typora 的 Vue 文档主题：绿色强调、深色代码块、引用底色 |
| [tailwindlabs/tailwindcss-typography](https://github.com/tailwindlabs/tailwindcss-typography) | `prose` 排版规范：slate 灰阶、强对比标题、深色代码块、下划线偏移 |
| [classless-css 主题清单](https://github.com/gmh5225/classless-css) | 带截图的轻量排版主题集合，适合快速浏览不同气质 |
| [VS Code Markdown 预览自定义 CSS](https://code.visualstudio.com/docs/languages/markdown#_markdown-preview) | 业界常见做法：预览样式与编辑器解耦、可切换 |

> 说明：以上只作为**视觉语言参考**，候选样式是按其特征重新实现的（未直接打包第三方 CSS 文件）。若决定直接采用 GitHub 样式，可引入其 MIT 许可的 `github-markdown.css`。

## 2. 七种候选（全部真实渲染）

| # | 风格 | 关键特征 | 最适合 |
| --- | --- | --- | --- |
| 00 | 当前 · Codex 极简 | 单色、发丝线、紧凑 | 与现有单条导航栏 / 多文件夹外壳最统一 |
| 01 | GitHub 文档风 | 系统字体、h1/h2 下划线、斑马纹表格、蓝色链接 | 通用技术笔记、README 风格文档 |
| 02 | Vue 文档风 | 绿色强调、深色代码块、引用浅灰底 | 代码/技术文档较多 |
| 03 | Notion 极简风 | 暖灰纸面、无边框标题、红色行内代码、极轻分隔线 | 长文写作、知识库，与单色外壳协调 |
| 04 | 飞书云文档风 | 蓝色强调、浅灰代码块、圆角引用 | 团队文档、中文工作流 |
| 05 | Tailwind Typography | slate 灰阶、深色代码块、强对比标题 | 现代产品文档、博客式排版 |
| 06 | 报刊衬线风 | 宋体/Georgia、暖纸背景、橙色强调 | 阅读型长文、随笔、专栏 |

单风格整篇长图（含代码块、表格、引用、图片）：

- [00 当前 Codex 极简](style-00-current.png)
- [01 GitHub 文档风](style-01-github.png)
- [02 Vue 文档风](style-02-vue.png)
- [03 Notion 极简风](style-03-notion.png)
- [04 飞书云文档风](style-04-feishu.png)
- [05 Tailwind Typography](style-05-tailwind.png)
- [06 报刊衬线风](style-06-serif.png)

## 3. 推荐

**首选：01 GitHub 文档风**
可读性最高、中文/英文都稳、表格和代码块识别度好，最适合「技术笔记 + README」场景；离当前极简风也不算远。

**次选：02 Vue 文档风 / 05 Tailwind Typography**
如果文档里代码很多，深色代码块会让结构更清晰、观感更「技术范」。

**最协调：03 Notion 极简风**
如果希望保持 MoDex 现有单色外壳的克制感、但让预览更温润精致，选它；暖灰纸面 + 无边框标题 + 红色行内代码很有辨识度。

**长文阅读：06 报刊衬线风**
正文换宋体/Georgia、暖纸背景，适合随笔和深度阅读，但代码/表格表现会相对弱一些。

## 4. 落地方式（已实施）

用户选择「全部内置、由用户选择」，因此采用方案 B 并已完成：

| 方案 | 状态 |
| --- | --- |
| A. 直接替换默认预览样式 | 未采用（默认仍为 Codex 极简） |
| B. 新增「预览样式」预设（7 套） | **已实现**：`设置 → 视图 → 预览样式 ▸` 切换，持久化、重启恢复、深浅主题各一套 |
| C. 微调当前样式 | 不适用 |

- 规格：`docs/PREVIEW-STYLE-SPEC.md`
- 入口：视图菜单 → 预览样式 ▸（7 个选项，当前项带 ✓）
- 默认：Codex 极简（与之前视觉一致）；选择会写入 settings.previewStyle
- 截图：`docs/screenshots/19-preview-style-github.png`（浅色 GitHub 风）、`20-preview-style-dark.png`（深色 Vue 风）

## 5. 复现方式

- 渲染脚本：`artifacts/style-gallery.mjs`（真实启动 MoDex → 注入候选 CSS → 分段滚动截图）
- 拼图脚本：`artifacts/build-gallery.py`（拼接长图 + 生成总览图）
- 原始截图与分段帧：`artifacts/style-gallery-raw/`
