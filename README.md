# HZ 个人工作台 (HZ Workbench)

Manage your daily journal, tasks, and projects from a single, draggable dashboard inside Obsidian.

HZ 个人工作台是一个面向 PARA 笔记仓库的 Obsidian 插件，把日记记录、时间统计、收支记账、任务清单和项目阶段甘特图聚合到一个可拖拽布局的工作台里。支持桌面端与移动端。

> 本插件是个人自用工具，随个人工作流持续演进。欢迎使用，但功能以实际发布为准。

## 功能一览

- **可拖拽工作台**：模块化布局，支持缩放与网格吸附；桌面端可自由拖动模块位置。
- **每日记录**：从「记录今日」入口快速补记时间、记账、随手记、今日冥想。
- **日记回顾**：3D 日记轮播，展示近期日记与连续记录热力图。
- **任务清单**：今日必完成、今日任务列表，支持读取 TickTickSync 本地缓存（**只读**，不回写 TickTick）。
- **项目总览**：项目阶段甘特图与进度视图。
- **多套配色**：6 套内置配色（深林翡翠 / 深海冰蓝 / 炭黑琥珀 / 午夜星紫 / 墨影黑白 / 棱镜玻璃·蓝金），并支持跟随 Obsidian 明暗模式自动切换。
- **移动端适配**：手机端信息架构重排（高频任务置顶）、触控手势与 44px 触控热区。

## 命令

| 命令 | 说明 |
|---|---|
| 打开个人工作台 | 打开工作台视图 |
| 刷新个人工作台数据 | 刷新数据 |
| 记录今日 | 打开记录弹窗 |
| 打开今日日记 | 跳转今日日记 |
| 结束当前计时 | 结束当前计时 |
| 补记时间 | 补记历史时间 |
| 记录收支 | 记录一笔收支 |
| 随手记 | 快速记录一条想法 |
| 今日冥想 | 记录今日冥想 |

## 天气说明

工作台左侧的天气区域当前**已停用**（默认关闭），作为预留占位区域保留。如需启用，可在「设置 → HZ 个人工作台 → 天气」中打开开关。

天气功能使用 [Open-Meteo](https://open-meteo.com/) 免费服务（无需 API Key），数据以 CC BY 4.0 授权，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

## 安装

### 从社区市场安装

在 Obsidian 的「设置 → 第三方插件 → 浏览」中搜索「HZ 个人工作台」即可安装。

### 手动安装

1. 从 [Releases](../../releases) 下载最新版 `main.js`、`styles.css`、`manifest.json`。
2. 将三个文件放入 Vault 的 `.obsidian/plugins/hz-workbench/` 目录。
3. 在「设置 → 第三方插件」中启用「HZ 个人工作台」。

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test
```

## 许可

本插件以 [MIT License](./LICENSE) 授权。

「棱镜玻璃·蓝金」配色参考自 [Prism Glass](https://github.com/csuyincs-creator/prism-glass)（Apache License 2.0），相关声明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)、[`LICENSE-prism-glass.txt`](./LICENSE-prism-glass.txt) 与 [`NOTICE-prism-glass.txt`](./NOTICE-prism-glass.txt)。
