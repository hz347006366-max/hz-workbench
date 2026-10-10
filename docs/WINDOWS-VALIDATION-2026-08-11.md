# Windows 实机验收记录（2026-08-11）

## 环境与发布物

- Windows 11 Pro `10.0.26200`，系统显示缩放 `125%`
- Obsidian `1.13.6`
- Vault：`F:\Obsidian`
- 插件：HZ 个人工作台 `0.2.1`
- 实机目录：`F:\Obsidian\.obsidian\plugins\hz-workbench`
- 安装前备份：`D:\Chat GPT\HZ--工作平台\备份\2026-08-11-212308-before-hz-workbench-0.2.1-Windows`
- 只覆盖 `main.js`、`manifest.json`、`styles.css`、`logo.png`；原 `data.json` 保持不动。

## 自动验证与构建

- 发布版本断言先出现预期 RED：`release-package.test.js` 为 `1 pass / 1 fail`，失败为 `0.2.0 !== 0.2.1`。
- 元数据改为 `0.2.1` 后同一测试 GREEN：`2/2` 通过。
- 实机保存问题的回归测试先 RED：`layout-store.test.js` 为 `14 pass / 1 fail`，模拟真实 Obsidian adapter 拒绝覆盖已有目标文件。
- 兼容修复后同一测试 GREEN：`15/15` 通过。
- 最终构建前 `pnpm run check`：`194/194` 通过。
- `pnpm run build`：exit `0`。
- 最终构建后 `pnpm run check`：`194/194` 通过。

## 精简安装与 SHA-256

仓库安装目录只有四个普通文件，没有目录、源码、测试、文档、source map、依赖或 Git 数据。开发产物、仓库安装包与实机安装文件逐项一致：

| 文件 | SHA-256 |
| --- | --- |
| `main.js` | `72FEBD71DD1193835F650F67A1E43A55973BDC576B3B589E3C7FC113321C6523` |
| `manifest.json` | `C86E54212A0222323AA0C9A698B8AF72254F50FE95D97CB74F902C1778B4541C` |
| `styles.css` | `0FC0A7979E195EDAF1D3385624ADCFBDFF6219BF786AC75CAAA99E6DC6651E58` |
| `logo.png` | `1D6D0AEA93BA4AD566AF6509DA331AC4CF3CFA61B9C018B811ABB578EC6804F6` |

## Obsidian 实机结果

- 使用命令面板执行“重新加载 Obsidian（不保存当前编辑内容）”，确认加载新构建。
- 展开和收起 Obsidian 左侧栏时，1440 逻辑画布按可用空间缩放，最大为 100%，保持居中；验收后左侧栏恢复收起。
- 年份下拉显示 `2026年 / 2025年 / 2024年`。选择 2024 后月份自动落到 12 月，卡片显示真实日期 `2024-12-01`、`2024-12-02`、`2024-12-05`。
- 从日记卡片用键盘激活后，在新标签页打开 `2024年-12-02-星期一`，同时保留工作台标签；没有编辑笔记，验收后关闭临时笔记标签。
- 依次切换翠绿、海蓝、琥珀、紫罗兰、墨影黑白；黑白主题为中性深色，日记封面仍保持彩色；最后恢复翠绿。
- 解锁自由布局后，编辑边框、模块名、撤销、恢复默认、取消等控件可见。Escape 取消后立即锁定且布局文件哈希不变。
- 首轮实机保存暴露真实错误：Obsidian `adapter.rename(temp, final)` 在 final 已存在时抛出 `Destination file already exists!`，界面正确保持解锁。修复为“支持覆盖的 adapter 继续使用原子 rename；拒绝覆盖时仅用已回读校验的 temp bytes 写回 final”后，实机保存会锁定。
- 将顶部模块从逻辑 `x=144` 临时移到 `x=160`，保存后的布局哈希变为 `860558A94A82A5A92AF83D4EB1D5988C8A353F82AF9CD08D1608A2A3CAEAA799`；完整重载后位移仍在，证明持久化生效。
- 验收后从备份恢复原 per-device 布局并再次完整重载；最终布局 SHA-256 为 `E7EE5E4A98A4A4E34BF5611059025D1878C9B3216FB86D666711B3EC7B369F6F`，与验收前完全一致。
- 冲突、无效布局和 save rejection 的“保持解锁”分支由自动测试覆盖；为避免故意破坏用户布局，实机未另外制造冲突。

## 结论

`0.2.1` 在 Windows 125% / Obsidian 1.13.6 环境下通过构建、全量测试、四文件安装、哈希一致性和实机交互验收。Vault 笔记未修改，原 per-device 布局已按验收前哈希恢复。
