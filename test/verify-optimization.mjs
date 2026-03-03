import { Embedder } from '../src/embedder.js';
import OpenAI from 'openai';

// 模擬配置
const config = {
  provider: "openai-compatible",
  apiKey: "sk-test",
  model: "jina-embeddings-v5-text-small",
  baseURL: "http://127.0.0.1:8317/v1", // 指向您的代理
  chunking: true
};

async function runTest() {
  console.log("🚀 開始優化機制驗證...");
  
  const embedder = new Embedder(config);
  
  // 1. 驗證超時設定 (內省)
  const clientTimeout = embedder['client'].timeout;
  console.log(`🔹 超時設定檢查: ${clientTimeout}ms (預期: 120000)`);
  if (clientTimeout === 120000) {
    console.log("✅ 120秒穩定性超時已正確注入。");
  } else {
    console.log("❌ 超時設定未生效！");
  }

  // 2. 驗證主動分段 (Proactive Chunking)
  console.log("\n🔹 測試長文本主動分段...");
  const longText = "這是一個測試文字。".repeat(1000); // 產生約 9,000 字
  console.log(`   測試文字長度: ${longText.length}`);
  
  try {
    // 我們不一定要真的發送成功（因為 apiKey 是假的），但我們要看它是否觸發了分段邏輯
    // 這裡我們攔截 console.log
    const originalLog = console.log;
    let chunkingTriggered = false;
    console.log = (msg) => {
      if (msg.includes("exceeds proactive threshold")) chunkingTriggered = true;
      originalLog(msg);
    };

    await embedder.embedSingle(longText).catch(() => {}); // 忽略 API 報錯
    
    console.log = originalLog; // 還原 log

    if (chunkingTriggered) {
      console.log("✅ 主動分段機制已成功觸發。");
    } else {
      console.log("❌ 主動分段機制未被觸發！(請檢查 threshold 設定)");
    }
  } catch (e) {
    console.log("執行過程發生意外:", e);
  }
}

runTest();
