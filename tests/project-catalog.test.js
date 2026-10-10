const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_INTERIOR_STAGES } = require('../src/project-catalog');

test('keeps the 15 interior stages in their confirmed continuous order', () => {
  assert.equal(DEFAULT_INTERIOR_STAGES.length, 15);
  assert.deepEqual(DEFAULT_INTERIOR_STAGES.map((stage) => stage.order), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(DEFAULT_INTERIOR_STAGES.map((stage) => stage.name), [
    '开工前准备', '开工交底', '结构改造', '门窗改造', '设备安装',
    '水电暖改造', '木工', '找平', '瓦工', '成品定制量尺下单',
    '油漆工', '前期主材施工', '安装定制产品', '后期主材施工', '软装进场',
  ]);
});

test('preserves every confirmed checklist item and material reminder', () => {
  assert.deepEqual(DEFAULT_INTERIOR_STAGES[0], {
    order: 1,
    name: '开工前准备',
    checklist: ['开通水电', '办理装修手续', '地暖打压'],
    materialReminders: ['压力表带压施工'],
  });
  assert.deepEqual(DEFAULT_INTERIOR_STAGES[5], {
    order: 6,
    name: '水电暖改造',
    checklist: ['厨房', '卫生间', '洗衣间', '客厅卧室', '直饮水位置', '全屋智能'],
    materialReminders: [
      '厨房需提前预定：热水器、烟机炉灶、洗碗机、蒸烤箱、净软水、冰箱',
      '卫生间需提前预定：暗埋卫浴、地漏',
      '洗衣间需提前预定：洗衣机、烘干机、壁挂洗衣机',
      '客厅卧室需提前预定：电视尺寸、影音设备',
      '全屋智能需提前预定：设备类型',
    ],
  });
  assert.deepEqual(DEFAULT_INTERIOR_STAGES[8].materialReminders, ['需提前预定：收口条']);
  assert.deepEqual(DEFAULT_INTERIOR_STAGES[6].materialReminders, ['需要提前购买：暗藏灯具']);
  assert.ok(DEFAULT_INTERIOR_STAGES.filter((stage) => ![1, 6, 7, 9].includes(stage.order)).every((stage) => stage.materialReminders.length === 0));
});

test('prevents callers from mutating the standard stage catalog', () => {
  assert.equal(Object.isFrozen(DEFAULT_INTERIOR_STAGES), true);
  assert.equal(Object.isFrozen(DEFAULT_INTERIOR_STAGES[0]), true);
  assert.equal(Object.isFrozen(DEFAULT_INTERIOR_STAGES[0].checklist), true);
  assert.equal(Object.isFrozen(DEFAULT_INTERIOR_STAGES[0].materialReminders), true);
});
