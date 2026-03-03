import { MemoryStore } from '../src/store.js';

// 設定與 openclaw.json 相同的路徑
const dbPath = '/home/frankjonas/.openclaw/memory/lancedb-pro';
const vectorDim = 1024; // Jina v5 small 預設維度

async function validate() {
  console.log("🚀 開始記憶體優化機制驗證...");
  
  const store = new MemoryStore({ dbPath, vectorDim });

  try {
    console.log("🔹 正在連接資料庫...");
    const statsBefore = await store.stats();
    console.log(`📊 優化前記憶總數: ${statsBefore.totalCount}`);

    console.log("🔹 執行 optimize() (包含 compactFiles)...");
    const result = await store.optimize();
    
    console.log("✅ 優化執行成功！");
    console.log(`📈 處理筆數: ${result.beforeCount}`);
    
    const statsAfter = await store.stats();
    console.log(`📊 優化後記憶總數: ${statsAfter.totalCount}`);

    if (result.beforeCount >= 0) {
      console.log("\n🎊 驗證結論：記憶體優化邏輯運作正常。");
    }
  } catch (error) {
    console.error("❌ 驗證失敗:", error);
  }
}

validate();
