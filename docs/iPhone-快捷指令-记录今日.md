# iPhone 快捷指令：记录今日

HZ 个人工作台 0.3.0 提供 Obsidian URI 协议入口：

`obsidian://hz-workbench-capture?action=动作名称`

## 推荐的单一快捷指令

在 iPhone「快捷指令」中创建一个名为「记录今日」的快捷指令：

1. 添加“从菜单中选择”，建立以下菜单项。
2. 每个菜单项中添加“URL”，填入对应地址。
3. 再添加“打开 URL”。

| 菜单 | action | URL |
| --- | --- | --- |
| 今日照片 | `photo` | `obsidian://hz-workbench-capture?action=photo` |
| 开始计时 | `start-time` | `obsidian://hz-workbench-capture?action=start-time` |
| 结束当前计时 | `finish-time` | `obsidian://hz-workbench-capture?action=finish-time` |
| 补记时间 | `manual-time` | `obsidian://hz-workbench-capture?action=manual-time` |
| 随手记 | `quick-note` | 见下方 |
| 记录收支 | `finance` | `obsidian://hz-workbench-capture?action=finance` |
| 打开今日日记 | `open-today` | `obsidian://hz-workbench-capture?action=open-today` |

“随手记”菜单项先添加“听写文本”或“询问输入”，再用“URL 编码”处理结果，最后打开：

`obsidian://hz-workbench-capture?action=quick-note&text=编码后的文本`

## 使用说明

- 快捷指令会短暂打开 Obsidian，这是 iOS 调用插件协议的正常行为。
- 第一次记录当天内容时，如今日日记不存在，插件会调用 Obsidian Daily Notes 创建并套用每日模板。
- 照片从相册选择，保存为 JPEG，默认最长边 2048 像素、质量 85%。同一天再次选择会替换当日照片。
- 分类、照片目录、压缩尺寸和“记录后打开日记”可在 HZ 个人工作台设置中调整。
- 今日任务与明日行动仍由 TickTickSync 只读展示；本功能不会写入、完成或删除 TickTick 任务。
