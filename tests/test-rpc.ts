/**
 * pisidian RPC 通信测试
 *
 * 运行方式：
 *   npx tsx src/test-rpc.ts
 *
 * 测试持久化 PiSession 的多轮对话、工具调用、会话统计等功能。
 */

import { PiSession } from '../src/rpc';

async function testBasicMessage() {
  console.log('=== 测试 1: 基础消息 ===');
  const session = new PiSession();

  try {
    const result = await session.sendMessage('你好！请用一句话介绍你自己。', { timeoutMs: 30_000 });
    console.log('[OK] 基础消息:', result.text.slice(0, 100) + '...');
    console.log('[OK] 统计:', result.stats);
  } catch (error) {
    console.error('[FAIL] 基础消息:', error);
  } finally {
    session.dispose();
  }
}

async function testMultiTurn() {
  console.log('\n=== 测试 2: 多轮对话 ===');
  const session = new PiSession();

  try {
    const r1 = await session.sendMessage('我们来做一个测试。请记住：我的名字叫测试者。', { timeoutMs: 30_000 });
    console.log('[OK] 第1轮:', r1.text.slice(0, 80) + '...');

    const r2 = await session.sendMessage('请问我叫什么名字？', { timeoutMs: 30_000 });
    const knowsName = r2.text.includes('测试者');
    console.log(knowsName ? '[OK] 第2轮 - 记住了名字' : '[WARN] 第2轮 - 未记住名字');
    console.log('  回复:', r2.text.slice(0, 100) + '...');
  } catch (error) {
    console.error('[FAIL] 多轮对话:', error);
  } finally {
    session.dispose();
  }
}

async function testToolCall() {
  console.log('\n=== 测试 3: 工具调用 ===');
  const session = new PiSession();

  try {
    const result = await session.sendMessage('列出当前目录下的文件', { timeoutMs: 60_000 });
    console.log('[OK] 工具调用 回复:', result.text.slice(0, 200) + '...');
    console.log('[OK] 片段数:', result.segments.length);
    for (const seg of result.segments) {
      console.log(`   - [${seg.type}] ${seg.toolName ? `工具:${seg.toolName}` : ''} ${seg.text.slice(0, 80)}...`);
    }
  } catch (error) {
    console.error('[FAIL] 工具调用:', error);
  } finally {
    session.dispose();
  }
}

async function testCodeGeneration() {
  console.log('\n=== 测试 4: 代码生成 ===');
  const session = new PiSession();

  try {
    const result = await session.sendMessage('用 TypeScript 写一个简单的 "Hello World" 函数', { timeoutMs: 30_000 });
    const hasCode = result.text.includes('function') || result.text.includes('console.log');
    console.log(hasCode ? '[OK] 代码生成 - 包含代码' : '[WARN] 代码生成 - 可能不包含代码');
    console.log('  回复:', result.text.slice(0, 200) + '...');
  } catch (error) {
    console.error('[FAIL] 代码生成:', error);
  } finally {
    session.dispose();
  }
}

async function testNewSession() {
  console.log('\n=== 测试 5: 新会话 ===');
  const session = new PiSession();

  try {
    await session.sendMessage('请记住这个数字：42', { timeoutMs: 30_000 });
    await session.newSession();
    const result = await session.sendMessage('请问我刚才让你记住的数字是多少？', { timeoutMs: 30_000 });
    const forgotNumber = !result.text.includes('42');
    console.log(forgotNumber ? '[OK] 新会话 - 已忘记之前的上下文' : '[WARN] 新会话 - 仍记得之前的上下文');
    console.log('  回复:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.error('[FAIL] 新会话:', error);
  } finally {
    session.dispose();
  }
}

async function main() {
  await testBasicMessage();
  await testMultiTurn();
  await testToolCall();
  await testCodeGeneration();
  await testNewSession();

  console.log('\n=== 所有测试完成 ===');
}

main().catch(console.error);
