# HZ 个人工作台 Mac 接续说明

## 当前状态

- 当前插件已能在 Obsidian 中运行。
- 已完成透明 PNG Logo、日记热力图、日记图片轮播、项目区、今日必完成、主题配色与 TickTickSync 对接规则。
- 已确认“所有模块自由拖动、自动吸附、等比例缩放、按设备保存”的布局编辑模式设计。
- 布局编辑模式尚未实施，后续在 Mac 上从设计规格继续。

## Mac 上继续开发

1. 解压开发接续包。
2. 安装 Node.js 20 或更高版本。
3. 在插件目录执行 `npm install`。
4. 运行 `node --test tests/*.test.js`，确认当前测试通过。
5. 阅读 `docs/superpowers/specs/2026-08-08-layout-editor-design.md`。
6. 审阅并确认规格后，编写实施计划，再开始编码。

## Mac 上安装当前版本

1. 解压精简安装包。
2. 把 `hz-workbench` 文件夹放入目标仓库的 `.obsidian/plugins/`。
3. 在 Obsidian 的“第三方插件”中启用“H​​Z 个人工作台”。
4. 使用命令面板运行“打开个人工作台”。

## 注意事项

- Windows 与 Mac 的 Obsidian 仓库路径不同，需要在插件设置中重新选择日记、项目与资源目录。
- TickTickSync 的账号登录和远端列表状态不会随本插件包迁移，需要在 Mac 上重新检查。
- 当前 TickTick 远端存在两个同名 `Inbox` 列表，需在 TickTick 中重命名或合并其中一个，才能避免同步插件中止。
- 不要把 Windows 的 `node_modules` 复制到 Mac；请在 Mac 上重新安装依赖。
