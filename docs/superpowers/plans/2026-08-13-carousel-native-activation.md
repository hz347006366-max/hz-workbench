# 轮播原生激活与拖拽分层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把轮播重构为原生按钮激活和延迟接管拖拽两条独立事件路径，使鼠标、Enter、Space 均在 Obsidian 实机中可靠打开对应日记新标签页，同时保留整卡拖动。

**Architecture:** `CarouselController` 继续管理卡池和轮播状态，但卡片改为原生 `button`，短按完全交给原生 `click`。新增明确的 `pending → dragging` 手势状态；只有 `pointermove` 达到 35px 后才捕获指针，拖拽完成只移动轮播并取消本次合成点击。生产导航提取为可测试的 Promise 安全边界，仍使用 `workspace.getLeaf('tab').openFile(journal.file)`。

**Tech Stack:** CommonJS、Node.js 内置测试运行器、jsdom、esbuild、Obsidian Plugin API、Windows Computer Use。

## Global Constraints

- 卡片必须为 `<button type="button">`；不得继续使用 `article[role="button"]`。
- 鼠标短按只由原生 `click` 打开；手势层不得在 `pointerup` 调用 `openJournal()`。
- 只有水平位移达到 35 CSS px 后才能进入 dragging 并捕获指针。
- Enter 和 Space 使用原生按钮行为；不得注册自定义 keydown 激活处理器。
- 日记必须通过 `workspace.getLeaf('tab').openFile(journal.file)` 在新标签页打开并保留工作台。
- 外观、尺寸、卡片 DOM 子结构、自动轮播、滚轮、年月筛选、移动端、自由布局和主题保持不变。
- 插件 ID、版本和最低 Obsidian 版本保持 `hz-workbench`、`0.2.1`、`1.5.0`；不增加运行时依赖。
- 不修改 TickTickSync、日记、每日模板、HZ `data.json`、logo、manifest 或布局文件。
- 鼠标、Enter、Space、拖拽四条实机路径任一失败均为发布阻断。

---

## 文件结构

- Modify: `development/obsidian-hz-workbench/src/carousel-controller.js` — 原生卡片和延迟拖拽状态机。
- Modify: `development/obsidian-hz-workbench/tests/carousel-controller.test.js` — DOM、短按、拖拽、取消、回收和键盘语义测试。
- Modify: `development/obsidian-hz-workbench/src/main.js` — Promise 安全的新标签页导航边界。
- Modify: `development/obsidian-hz-workbench/tests/render-boundary.test.js` — 生产导航和错误处理回归。
- Modify: `development/obsidian-hz-workbench/tests/production-integration.test.js` — 活动叶变化取消轮播拖拽的生产接线。
- Modify: `development/obsidian-hz-workbench/styles.css` — 原生按钮视觉重置和键盘焦点样式。
- Generated: `development/obsidian-hz-workbench/main.js` — esbuild bundle。
- Generated: `install/hz-workbench/main.js`、`install/hz-workbench/styles.css` — 安装产物。

---

### Task 1: 原生按钮与延迟拖拽状态机

**Files:**
- Modify: `development/obsidian-hz-workbench/src/carousel-controller.js`
- Modify: `development/obsidian-hz-workbench/tests/carousel-controller.test.js`

**Interfaces:**
- Produces card: `HTMLButtonElement` with `type="button"`, class `hz-jcard`, current `__journal`.
- Gesture state: `{ phase: 'pending' | 'dragging', pointerId, startX, card, captureTarget } | null`.
- Produces: `onPointerMove(event)`, `cancelPointerGesture()`.
- Consumes existing: `dragDirection(distance)`, `move(direction)`, `activateCard(card)`.

- [ ] **Step 1: 写原生按钮与短按失败测试**

在 `carousel-controller.test.js` 新增断言：

```js
test('cards are native buttons and a pending pointer gesture leaves activation to click', () => {
  const context = setup(journalsFor('2026', '08', 8));
  context.controller.mount();
  const card = context.section.querySelector('.hz-slot-3');
  assert.equal(card.tagName, 'BUTTON');
  assert.equal(card.type, 'button');

  let captures = 0;
  card.setPointerCapture = () => { captures += 1; };
  card.dispatchEvent(pointerEvent(context.dom.window, 'pointerdown', 100));
  card.dispatchEvent(pointerEvent(context.dom.window, 'pointerup', 110));
  assert.equal(captures, 0);
  assert.deepEqual(context.opened, []);

  card.click();
  assert.deepEqual(context.opened, [card.__journal]);
});
```

同时删除或改写当前“pointerup 无 click 即打开”的测试，因为该行为与新规格相反。

- [ ] **Step 2: 运行聚焦测试确认 RED**

Run:

```powershell
& $node --test --test-name-pattern "native buttons|pending pointer" tests/carousel-controller.test.js
```

Expected: FAIL；当前元素为 `ARTICLE`，且 pointerdown 会捕获、pointerup 会主动打开。

- [ ] **Step 3: 写拖拽接管失败测试**

新增测试覆盖：34px 不捕获；35px 的 `pointermove` 才转入 dragging 并在卡片上捕获；pointerup 移动轮播且不打开；紧随的合成 click 被吞掉一次；下一次普通 click 可打开当前绑定日记。

测试必须派发真实顺序：

```js
pointerdown(100) -> pointermove(134) -> pointermove(135) -> pointerup(135) -> click -> click
```

并断言第一次 click 后 `opened=[]`，第二次 click 后 `opened=[currentCard.__journal]`。

- [ ] **Step 4: 运行拖拽测试确认 RED**

Run:

```powershell
& $node --test --test-name-pattern "captures only after|drag synthetic" tests/carousel-controller.test.js
```

Expected: FAIL；当前控制器没有 `pointermove` 监听和 phase 状态。

- [ ] **Step 5: 实现最小状态机**

在 `mount()` 注册 stage 的 `pointermove`。将 `onPointerDown` 改为只记录 pending，不捕获：

```js
this.pointer = {
  phase: 'pending',
  pointerId: event.pointerId,
  startX: Number(event.clientX) || 0,
  card: event.target?.closest?.('.hz-jcard') || null,
  captureTarget: null,
};
```

`onPointerMove` 只有在同一 pointer 且 `Math.abs(clientX - startX) >= 35` 时设置 `phase='dragging'`，以 `card || stage` 为捕获目标，并调用一次 `setPointerCapture(pointerId)`。

`onPointerUp`：pending 只清理；dragging 计算方向、移动轮播、释放捕获并为本次手势标记 `cancelledActivationCard`。不得调用 `activateCard()`。

`pointercancel` 和 `destroy()` 统一调用 `cancelPointerGesture()`，安全释放当前捕获并清理状态。

- [ ] **Step 6: 把卡片改为原生按钮并删除键盘 handler**

`createCard()` 使用：

```js
const card = document.createElement('button');
card.type = 'button';
card.className = 'hz-jcard';
```

删除 `role="button"` 和自定义 `keydownHandler`。保留一个 click handler：若卡片等于本次 `cancelledActivationCard`，只吞掉并立即清除；否则调用 `activateCard(card)`。增加零延时兜底清除只绑定当前手势 token，避免没有合成 click 时影响下一次用户点击。

- [ ] **Step 7: 增加取消、销毁和回收测试**

断言 `pointercancel`、`destroy()` 和现有活动叶中断路径清除 phase/捕获且不打开；卡片回收后 click 读取当前 `__journal`；封面、标题、空白区通过按钮冒泡触发同一原生 click 路径。

- [ ] **Step 8: 运行 Task 1 全部聚焦测试**

Run:

```powershell
& $node --test tests/carousel-controller.test.js
```

Expected: 全部 PASS，输出无 warning/error。

- [ ] **Step 9: 提交 Task 1**

```powershell
git add development/obsidian-hz-workbench/src/carousel-controller.js development/obsidian-hz-workbench/tests/carousel-controller.test.js
git commit -m "refactor: separate carousel activation from dragging"
```

---

### Task 2: 生产导航错误边界与视觉回归

**Files:**
- Modify: `development/obsidian-hz-workbench/src/main.js`
- Modify: `development/obsidian-hz-workbench/tests/render-boundary.test.js`
- Modify: `development/obsidian-hz-workbench/tests/production-integration.test.js`
- Modify: `development/obsidian-hz-workbench/styles.css`
- Modify: `development/obsidian-hz-workbench/tests/ui.test.js`

**Interfaces:**
- Produces: `WorkbenchView.openJournalInNewTab(journal): Promise<void>`.
- Calls exactly: `this.app.workspace.getLeaf('tab').openFile(journal.file)`.
- Carousel callback: `openJournal: (journal) => { void this.openJournalInNewTab(journal); }`.

- [ ] **Step 1: 写 Promise 拒绝边界失败测试**

在 `render-boundary.test.js` 通过生产模块测试工具构造 `getLeaf('tab').openFile()` rejection，断言：

- `getLeaf` 只收到 `'tab'`；
- `openFile` 收到当前 `journal.file`；
- Promise rejection 被消费；
- `Notice` 收到固定可读文案 `无法打开对应日记，请稍后重试`；
- 工作台没有被替换或关闭。

- [ ] **Step 2: 运行边界测试确认 RED**

Run:

```powershell
& $node --test --test-name-pattern "journal navigation rejection" tests/render-boundary.test.js
```

Expected: FAIL；当前直接返回 `openFile` Promise，没有错误 Notice 边界。

- [ ] **Step 3: 实现导航方法并接线**

新增：

```js
async openJournalInNewTab(journal) {
  try {
    await this.app.workspace.getLeaf('tab').openFile(journal.file);
  } catch (error) {
    console.error('[HZ Workbench] Failed to open journal', error);
    new Notice('无法打开对应日记，请稍后重试');
  }
}
```

`renderJournal()` 的 callback 只调用该方法。此处“保持生产回调”解释为保持同一 Obsidian 操作和参数，而不是保留不可捕获 rejection 的旧单行字面形式。

同时在 `WorkbenchView.handleActiveLeafChange()` 的 inactive 分支中，在 pause 前调用：

```js
this.carouselController?.cancelPointerGesture?.();
```

在 `production-integration.test.js` 的 active-leaf 用例中注入带 `cancelPointerGesture` 计数的真实控制器边界，断言切离工作台时只取消一次未完成手势、暂停一次；切回只恢复，不打开日记。

- [ ] **Step 4: 写原生按钮 CSS 失败测试**

在 `ui.test.js` 断言 `.hz-jcard` 显式重置 `appearance`、padding、font、color、text-align，并存在 `.hz-jcard:focus-visible` 的主题 token 焦点轮廓；同时现有位置、尺寸、transition、移动端和 reduced-motion 选择器保持。

- [ ] **Step 5: 实现最小 CSS**

在现有 `.hz-jcard` 规则加入按钮重置，不改变几何值；新增键盘专用 focus-visible outline。同步修改只发生在 development CSS，install copy 留给 Task 3 构建阶段统一同步。

- [ ] **Step 6: 运行 Task 2 聚焦测试**

Run:

```powershell
& $node --test tests/render-boundary.test.js tests/production-integration.test.js tests/ui.test.js tests/carousel-controller.test.js
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交 Task 2**

```powershell
git add development/obsidian-hz-workbench/src/main.js development/obsidian-hz-workbench/styles.css development/obsidian-hz-workbench/tests/render-boundary.test.js development/obsidian-hz-workbench/tests/production-integration.test.js development/obsidian-hz-workbench/tests/ui.test.js
git commit -m "fix: harden carousel journal navigation"
```

---

### Task 3: 构建、安装与四路径实机验收

**Files:**
- Generated: `development/obsidian-hz-workbench/main.js`
- Generated: `install/hz-workbench/main.js`
- Generated: `install/hz-workbench/styles.css`
- Install only: `F:/Obsidian/.obsidian/plugins/hz-workbench/main.js`
- Install only: `F:/Obsidian/.obsidian/plugins/hz-workbench/styles.css`

**Interfaces:**
- Development/install/live `main.js` hashes equal.
- Development/install/live `styles.css` hashes equal.
- Protected inventory remains byte-identical.

- [ ] **Step 1: 运行 fresh 构建前检查**

```powershell
& $node scripts/check-syntax.js
& $node --test tests/*.test.js
```

Expected: 0 failures；记录准确测试总数。

- [ ] **Step 2: 构建并同步仓库安装产物**

```powershell
& $node esbuild.config.mjs
Copy-Item -LiteralPath main.js -Destination '..\..\install\hz-workbench\main.js' -Force
Copy-Item -LiteralPath styles.css -Destination '..\..\install\hz-workbench\styles.css' -Force
& $node --test tests/release-package.test.js
```

Expected: build exit 0，release-package 0 failures。

- [ ] **Step 3: 建立保护基线和完整备份**

记录并备份 live HZ 插件全部文件；记录 `data.json`、manifest、logo、布局、每日模板、70 篇日记 inventory 和 TickTickSync inventory SHA-256。备份目录：

```text
D:/Chat GPT/HZ--工作平台/备份/YYYYMMDD-HHMMSS-before-native-carousel-activation
```

备份逐文件哈希必须与 live 安装前一致。

- [ ] **Step 4: 只安装 main.js 和 styles.css**

覆盖 live HZ 的两个文件，不复制 manifest/data/logo，不改布局、模板、日记或 TickTickSync。核对 development/install/live 三端两类产物 SHA-256。

- [ ] **Step 5: 重载 Obsidian 并做鼠标验收**

使用 Windows Computer Use 精确选择唯一 Obsidian 工作台窗口。一次 fresh screenshot 后点击中心卡片；验收必须同时看到正确日记标签和仍存在的工作台标签。若失败，立即判定阻断并停止安装完成声明。

- [ ] **Step 6: 做 Enter 与 Space 验收**

返回工作台，通过 Tab 将焦点移动到中心原生按钮并从可访问性或 `:focus-visible` 证明焦点；分别用 Enter、Space 打开正确日记。每次打开后返回工作台，不删除任何文件。

- [ ] **Step 7: 做拖拽与回归验收**

横向拖动中心卡片超过 35px，确认轮播切换且没有日记标签打开；随后普通点击新中心卡片必须打开。检查年月筛选、滚轮、自动轮播、自由布局锁、主题和只读任务面板仍可用。

- [ ] **Step 8: 恢复可见状态并完成保护审计**

关闭验收产生的临时日记标签属于普通 UI 清理，不删除笔记。恢复用户原工作台可见状态。核对所有受保护哈希和 inventories 与 Step 3 一致。

- [ ] **Step 9: 最终 fresh 验证**

```powershell
& $node scripts/check-syntax.js
& $node --test tests/*.test.js
& $node --test tests/release-package.test.js
git diff --check
git status --short
```

Expected: 全部 0 failures；仅预期生成产物未提交，或提交后工作树干净。

- [ ] **Step 10: 提交发布产物**

```powershell
git add development/obsidian-hz-workbench/main.js install/hz-workbench/main.js install/hz-workbench/styles.css
git commit -m "release: install native carousel activation"
```

如果构建产物已在前述提交中完全一致且无 tracked diff，不创建空提交。

---

## 最终审查门

- 对本计划完整 diff 做独立规格与代码质量审查。
- Critical/Important 必须修复并复审；Minor 记录并由最终审查统一裁决。
- 只有完整测试、release 校验、三端哈希、四条实机路径、保护审计和独立审查全部通过，才允许把轮播阻断标记为解除。
