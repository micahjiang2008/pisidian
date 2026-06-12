import type { ModelProviderOption, SelectOption, SlashCommandOption, ThinkingLevelMap } from './types';

interface PiRpcModel {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

interface PiRpcSlashCommand {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
}

const DEFAULT_THINKING_LEVEL_MAP: ThinkingLevelMap = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

type PiRpcResponse =
  | {
      id?: string;
      type: 'response';
      command: string;
      success: true;
      data?: unknown;
    }
  | {
      id?: string;
      type: 'response';
      command: string;
      success: false;
      error: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

const MODEL_LIST_REQUEST_ID = 'pisidian-list-models';
const COMMAND_LIST_REQUEST_ID = 'pisidian-list-commands';

function toTitleCaseProvider(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatContextWindow(tokens: number | undefined): string | null {
  if (!tokens || !Number.isFinite(tokens)) return null;
  if (tokens >= 1000000) return `${Math.round(tokens / 1000000)}m ctx`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`;
  return `${tokens} ctx`;
}

function getThinkingLevelMap(model: PiRpcModel): ThinkingLevelMap | null {
  if (model.thinkingLevelMap) return model.thinkingLevelMap;
  if (model.reasoning) return DEFAULT_THINKING_LEVEL_MAP;
  return null;
}

function getModelBadges(model: PiRpcModel): string[] {
  const badges: string[] = [];
  const thinkingLevelMap = getThinkingLevelMap(model);

  if (thinkingLevelMap) badges.push('Thinking');
  if (thinkingLevelMap?.xhigh !== undefined && thinkingLevelMap.xhigh !== null) {
    badges.push('XHigh');
  }
  if (model.input?.includes('image')) badges.push('Image');

  const contextWindow = formatContextWindow(model.contextWindow);
  if (contextWindow) badges.push(contextWindow);

  return badges;
}

function toModelOption(model: PiRpcModel): SelectOption & { thinkingLevelMap?: ThinkingLevelMap } {
  return {
    value: `${model.provider}/${model.id}`,
    label: model.name || model.id,
    badges: getModelBadges(model),
    thinkingLevelMap: getThinkingLevelMap(model) ?? undefined,
  };
}

function groupModels(models: PiRpcModel[]): ModelProviderOption[] {
  const grouped = new Map<string, SelectOption[]>();

  for (const model of models) {
    if (!model.provider || !model.id) continue;

    const options = grouped.get(model.provider) ?? [];
    options.push(toModelOption(model));
    grouped.set(model.provider, options);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, options]) => ({
      provider: toTitleCaseProvider(provider),
      models: options.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

function isModelListResponse(response: PiRpcResponse): response is PiRpcResponse & {
  success: true;
  data: { models: PiRpcModel[] };
} {
  return (
    response.type === 'response' &&
    response.command === 'get_available_models' &&
    response.success === true &&
    typeof response.data === 'object' &&
    response.data !== null &&
    Array.isArray((response.data as { models?: unknown }).models)
  );
}

function isCommandListResponse(response: PiRpcResponse): response is PiRpcResponse & {
  success: true;
  data: { commands: PiRpcSlashCommand[] };
} {
  return (
    response.type === 'response' &&
    response.command === 'get_commands' &&
    response.success === true &&
    typeof response.data === 'object' &&
    response.data !== null &&
    Array.isArray((response.data as { commands?: unknown }).commands)
  );
}

function getPiCommands(): string[] {
  const appData = process.env.APPDATA;
  const userProfile = process.env.USERPROFILE;
  const piCommands = [
    'pi',
    appData ? `${appData}\\npm\\pi.cmd` : undefined,
    userProfile ? `${userProfile}\\AppData\\Roaming\\npm\\pi.cmd` : undefined,
  ].filter((command): command is string => Boolean(command));

  return Array.from(new Set(piCommands));
}

async function requestModelsFromPiRpc(): Promise<PiRpcModel[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require('child_process');

  let lastError: Error | undefined;

  for (const command of getPiCommands()) {
    try {
      return await requestModelsWithCommand(spawn, command);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Unable to find pi executable');
}

async function requestCommandsFromPiRpc(cwd?: string): Promise<PiRpcSlashCommand[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require('child_process');

  let lastError: Error | undefined;

  for (const command of getPiCommands()) {
    try {
      return await requestCommandsWithCommand(spawn, command, cwd);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Unable to find pi executable');
}

function requestModelsWithCommand(
  spawn: (command: string, args: readonly string[], options: any) => any,
  command: string,
): Promise<PiRpcModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['--mode', 'rpc', '--no-session', '--offline'], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Timed out while requesting pi model list'));
    }, 10000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let message: PiRpcResponse;
        try {
          message = JSON.parse(line) as PiRpcResponse;
        } catch {
          continue;
        }

        if (isModelListResponse(message)) {
          settled = true;
          window.clearTimeout(timeout);
          child.stdin.end();
          child.kill();
          resolve(message.data.models);
          return;
        }

        if (
          message.type === 'response' &&
          message.command === 'get_available_models' &&
          message.success === false &&
          typeof message.error === 'string'
        ) {
          settled = true;
          window.clearTimeout(timeout);
          child.stdin.end();
          child.kill();
          reject(new Error(message.error));
          return;
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(error);
    });

    child.on('exit', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error(stderr.trim() || 'pi RPC exited before returning model list'));
    });

    child.stdin.write(`${JSON.stringify({ id: MODEL_LIST_REQUEST_ID, type: 'get_available_models' })}\n`);
  });
}

function requestCommandsWithCommand(
  spawn: (command: string, args: readonly string[], options: any) => any,
  command: string,
  cwd?: string,
): Promise<PiRpcSlashCommand[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['--mode', 'rpc', '--no-session', '--offline'], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd || undefined,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Timed out while requesting pi command list'));
    }, 10000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let message: PiRpcResponse;
        try {
          message = JSON.parse(line) as PiRpcResponse;
        } catch {
          continue;
        }

        if (isCommandListResponse(message)) {
          settled = true;
          window.clearTimeout(timeout);
          child.stdin.end();
          child.kill();
          resolve(message.data.commands);
          return;
        }

        if (
          message.type === 'response' &&
          message.command === 'get_commands' &&
          message.success === false &&
          typeof message.error === 'string'
        ) {
          settled = true;
          window.clearTimeout(timeout);
          child.stdin.end();
          child.kill();
          reject(new Error(message.error));
          return;
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(error);
    });

    child.on('exit', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error(stderr.trim() || 'pi RPC exited before returning command list'));
    });

    child.stdin.write(`${JSON.stringify({ id: COMMAND_LIST_REQUEST_ID, type: 'get_commands' })}\n`);
  });
}

export function toSkillCommandOptions(commands: PiRpcSlashCommand[]): SlashCommandOption[] {
  return commands
    .filter((command) => command.source === 'skill' && command.name)
    .map((command) => ({
      id: command.name,
      name: command.name,
      label: command.name,
      description: command.description,
      category: 'skill',
    }));
}

export interface ListModelsResult {
  models: ModelProviderOption[];
  /** Maps a model value (e.g. "provider/id") to its thinkingLevelMap, or null if none. */
  thinkingLevelMapByModel: Record<string, ThinkingLevelMap | null>;
}

export async function listModels(): Promise<ListModelsResult> {
  const rawModels = await requestModelsFromPiRpc();

  const thinkingLevelMapByModel: Record<string, ThinkingLevelMap | null> = {};
  for (const m of rawModels) {
    const key = `${m.provider}/${m.id}`;
    thinkingLevelMapByModel[key] = getThinkingLevelMap(m);
  }

  return {
    models: groupModels(rawModels),
    thinkingLevelMapByModel,
  };
}

export async function listSkillCommands(workDir?: string): Promise<SlashCommandOption[]> {
  const commands = await requestCommandsFromPiRpc(workDir);
  return toSkillCommandOptions(commands);
}
