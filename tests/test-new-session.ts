/**
 * 测试 newSession 是否导致进程退出
 */
import { PiSession } from '../src/rpc';

async function main() {
  console.log('=== 测试 newSession 隔离 ===');
  const session = new PiSession();
  
  try {
    // 先发送一条消息确保进程启动
    const r1 = await session.sendMessage('你好', { timeoutMs: 30_000 });
    console.log('[OK] 初始消息:', r1.text.slice(0, 50));

    // 尝试 newSession
    console.log('[INFO] 调用 newSession()...');
    await session.newSession();
    console.log('[OK] newSession 完成');

    // 再发一条消息验证
    const r2 = await session.sendMessage('你好', { timeoutMs: 30_000 });
    console.log('[OK] newSession后消息:', r2.text.slice(0, 50));
  } catch (error) {
    console.error('[FAIL]', error);
  } finally {
    session.dispose();
  }
}

main();
