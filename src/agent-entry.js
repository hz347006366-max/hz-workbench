const COPILOT_PLUGIN_ID = 'copilot';
const COPILOT_AGENT_COMMAND_ID = 'copilot:agent-chat-open-window';

function resolveCopilotAgentEntry({ desktop, pluginEnabled, commandAvailable }) {
  if (!desktop) {
    return Object.freeze({
      kind: 'mobile',
      status: '请在桌面端使用 Copilot Agent',
      available: false,
    });
  }
  if (!pluginEnabled) {
    return Object.freeze({
      kind: 'missing',
      status: '未检测到 Copilot',
      available: false,
    });
  }
  if (!commandAvailable) {
    return Object.freeze({
      kind: 'setup',
      status: 'Copilot 需要完成配置',
      available: false,
    });
  }
  return Object.freeze({
    kind: 'available',
    status: 'Copilot 已接入',
    available: true,
  });
}

module.exports = {
  COPILOT_PLUGIN_ID,
  COPILOT_AGENT_COMMAND_ID,
  resolveCopilotAgentEntry,
};
