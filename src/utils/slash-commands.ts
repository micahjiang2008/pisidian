import type { SlashCommandOption } from '../types';

/**
 * 从输入文本中提取正在输入的斜杠命令查询词。
 * 匹配末尾的 `/word` 模式（允许前导空格）。
 * 返回命令名（不含 `/`），无匹配时返回 null。
 */
export function getSlashQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)\/([^\s]*)$/);
  return match?.[1] ?? null;
}

/**
 * 将输入文本末尾的 `/word` 替换为选中的完整命令名。
 */
export function getValueWithCommand(value: string, command: SlashCommandOption): string {
  return value.replace(/(?:^|\s)\/([^\s]*)$/, (token) => {
    const prefix = token.startsWith(' ') ? ' ' : '';
    return `${prefix}/${command.name} `;
  });
}

/**
 * 根据查询词过滤斜杠命令列表。
 */
export function filterSlashCommands(
  commands: SlashCommandOption[],
  query: string | null,
): SlashCommandOption[] {
  if (query === null) return [];
  return commands.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(query.toLowerCase()),
  );
}
