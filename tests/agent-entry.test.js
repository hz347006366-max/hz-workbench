const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COPILOT_PLUGIN_ID,
  COPILOT_AGENT_COMMAND_ID,
  resolveCopilotAgentEntry,
} = require('../src/agent-entry');

test('exports the Copilot plugin and agent command identifiers', () => {
  assert.equal(COPILOT_PLUGIN_ID, 'copilot');
  assert.equal(COPILOT_AGENT_COMMAND_ID, 'copilot:agent-chat-open-window');
});

test('resolves Copilot entry states in mobile, missing, setup, available priority order', () => {
  const cases = [
    {
      input: { desktop: false, pluginEnabled: true, commandAvailable: true },
      expected: { kind: 'mobile', status: '请在桌面端使用 Copilot Agent', available: false },
    },
    {
      input: { desktop: true, pluginEnabled: false, commandAvailable: true },
      expected: { kind: 'missing', status: '未检测到 Copilot', available: false },
    },
    {
      input: { desktop: true, pluginEnabled: true, commandAvailable: false },
      expected: { kind: 'setup', status: 'Copilot 需要完成配置', available: false },
    },
    {
      input: { desktop: true, pluginEnabled: true, commandAvailable: true },
      expected: { kind: 'available', status: 'Copilot 已接入', available: true },
    },
  ];

  for (const { input, expected } of cases) {
    const state = resolveCopilotAgentEntry(input);
    assert.deepEqual(state, expected);
    assert.equal(Object.isFrozen(state), true);
  }

  assert.equal(resolveCopilotAgentEntry({
    desktop: false,
    pluginEnabled: false,
    commandAvailable: false,
  }).kind, 'mobile');
  assert.equal(resolveCopilotAgentEntry({
    desktop: true,
    pluginEnabled: false,
    commandAvailable: false,
  }).kind, 'missing');
});
