# 轮播原生激活与拖拽分层设计

## 背景与目标

当前轮播同时让卡片承担“打开日记”和“指针捕获拖拽”两类职责。Obsidian 1.13.6 实机中，自动化测试虽然覆盖了 `click`、`pointerup` 和 `getLeaf('tab')`，但真实鼠标短按始终没有打开日记。连续两次局部事件补丁均未通过实机验收，因此不再继续叠加 `pointerup/click` 特判。

本次重构的目标是让浏览器原生按钮语义负责激活，让独立手势状态机只在确认拖拽后接管指针。用户看到的外观、卡片尺寸、自动轮播、滚轮、拖拽、年月筛选和新标签页行为保持不变。

## 选定方案

采用“原生按钮 + 延迟拖拽接管”方案。

- 每张轮播卡片使用真正的 `<button type="button">`，不再使用带 `role="button"` 的普通 `div`。
- 普通鼠标短按不调用 `setPointerCapture()`，由浏览器自然产生按钮 `click`。
- 指针移动达到 35 CSS 像素后，状态从 `pending` 转为 `dragging`；只有这时手势层才接管指针并执行轮播移动。
- 已确认拖拽的手势阻止该次按钮激活；短按和键盘激活不经过拖拽分支。
- `click` 是唯一打开日记的鼠标入口；`Enter` 和 `Space` 使用原生按钮行为，不再额外注册自定义键盘激活逻辑。

不采用以下方案：

- 独立拖拽手柄：可靠，但会改变当前整卡拖动习惯。
- 取消鼠标拖拽：实现简单，但会损失已经确认保留的交互。

## 组件边界

### 卡片激活层

卡片激活层只负责一件事：将当前卡片绑定的日记传给 `openJournal(journal)`。

- 输入：原生按钮 `click` 事件和卡片当前的 `__journal`。
- 前置条件：卡片可见、`tabIndex === 0`、`aria-hidden !== 'true'`、当前未被本次拖拽取消。
- 输出：调用一次 `openJournal(card.__journal)`。
- 不负责：指针捕获、拖拽距离计算、卡片移动、轮播索引更新。

生产回调保持：

```js
openJournal: (journal) => this.app.workspace.getLeaf('tab').openFile(journal.file)
```

日记在新标签页打开，工作台标签保留。

### 拖拽手势层

手势层维护一个独立状态：

```js
{
  phase: 'pending' | 'dragging',
  pointerId,
  startX,
  card
}
```

事件流：

1. `pointerdown`：记录 `pending`，不捕获指针，不打开日记。
2. `pointermove`：位移小于 35px 时保持 `pending`；达到阈值后转为 `dragging`，此时才捕获指针并阻止按钮原生激活。
3. `pointerup`：
   - `pending`：清理手势状态，不阻止随后原生 `click`。
   - `dragging`：按方向移动轮播，释放捕获，并屏蔽这一次拖拽产生的 `click`。
4. `pointercancel`、视图销毁或活动叶变化：释放捕获并清理状态，不打开日记。

手势层不直接调用 `openJournal()`。

## 重复激活与异常处理

- 短按只由原生 `click` 打开一次，删除当前 `pointerup` 主动激活逻辑。
- 拖拽屏蔽必须绑定到一次具体手势，而不是用可能影响下一次真实点击的宽泛计时状态。
- 若浏览器在拖拽后产生合成 `click`，卡片处理器识别本次已取消的手势并吞掉；状态在处理后立即清除。
- `openJournal()` 返回的 Promise 由生产边界捕获拒绝并显示可读 Notice，避免未处理 Promise；失败时工作台保持原状。
- 卡片在回收复用后，点击必须读取它当时绑定的 `__journal`，不得闭包捕获旧日记。

## 可访问性与视觉约束

- 原生按钮必须保留现有卡片 DOM 子结构和 CSS class，以保持封面、标题、摘要、3D 位置、尺寸和动画不变。
- 重置按钮默认边框、字体、内边距和文本对齐，视觉上与当前 `.hz-jcard` 一致。
- 只有可访问卡片进入 Tab 顺序；准备态和离屏卡片仍为 `tabIndex = -1` 且 `aria-hidden = true`。
- Enter/Space 依赖原生按钮语义；焦点轮廓使用现有主题 token，并在键盘聚焦时清晰可见。
- `prefers-reduced-motion`、移动端布局和自由布局编辑模式行为保持不变。

## 测试策略

### 纯状态与 DOM 测试

- 卡片元素确实为 `HTMLButtonElement`，`type="button"`。
- pointerdown/up 小于 35px 不捕获、不主动打开；随后原生 click 打开一次。
- 达到 35px 才进入 dragging 并捕获；拖拽移动轮播且不打开日记。
- 拖拽后的合成 click 被屏蔽一次，下一次真实 click 正常打开。
- pointercancel、销毁和活动叶切换释放手势状态。
- 回收卡片、图片、标题、空白区点击均打开当前绑定日记。
- Enter/Space 使用原生按钮路径，不存在重复自定义键盘 handler。

### 生产边界测试

- 生产代码仍只使用 `workspace.getLeaf('tab').openFile(journal.file)`。
- Promise 拒绝被捕获并产生可读错误提示。
- 工作台 owner、布局模块、筛选、自动轮播和滚轮测试全部保持通过。

### 实机验收

安装前完整备份 live HZ 插件，只覆盖 `main.js` 和必要的 `styles.css`。在 Obsidian 1.13.6 中至少验证：

1. 鼠标点击中心卡片打开正确日记新标签页，工作台标签仍保留。
2. 返回工作台后，Tab 聚焦中心卡片，Enter 打开正确日记。
3. 返回工作台后，Space 打开正确日记。
4. 横向拖动卡片切换轮播但不打开日记；随后普通点击仍可打开。
5. 年月筛选、自动轮播、滚轮、自由布局锁、主题和只读任务面板无回归。

任何一项实机激活失败都视为发布阻断，不能用自动化测试替代。

## 数据与发布安全

- 不修改 TickTickSync 插件、配置、缓存或任务。
- 不修改任何日记内容、每日模板、HZ `data.json`、logo、manifest 或布局文件。
- 插件 ID、版本和最低 Obsidian 版本保持 `hz-workbench`、`0.2.1`、`1.5.0`。
- 不增加运行时依赖。
- 构建后 development/install/live 的 `main.js` 和 `styles.css` SHA-256 必须分别一致。
- 最终必须通过完整测试、发布包测试、保护文件哈希审计和 Git 工作树检查。

## 完成标准

只有同时满足以下条件才算完成：

- 新分层架构的 RED/GREEN 测试成立；
- 完整自动化测试与发布包检查零失败；
- 三端构建产物哈希一致；
- 鼠标、Enter、Space 和拖拽四条实机路径全部通过；
- 工作台保留、正确日记在新标签页打开；
- 所有用户数据和受保护文件零差异；
- 独立代码审查无 Critical 或 Important 问题。
