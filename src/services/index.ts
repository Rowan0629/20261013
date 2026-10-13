import type { ChatService } from './ChatService';
import { createMockChatService, type MockControls } from './mock/mockChatService';
import { createSupabaseChatService } from './supabase/supabaseChatService';

// 這裡是「畫面用哪一種後端」唯一的切換點。畫面的程式碼只認 ChatService 的規格，完全不知道用的是哪一種。
// 用 || 而不是 ??：GitHub Actions 讀不到的變數會變成「空字串」而不是「沒有」，空字串也要當作預設的 mock。
const backend = import.meta.env.VITE_BACKEND || 'mock';

function create(): { service: ChatService; mockControls: MockControls | null } {
  if (backend === 'mock') {
    const mock = createMockChatService();
    return { service: mock, mockControls: mock.controls };
  }
  if (backend === 'supabase') {
    // 這兩個值都是「可以公開」的（Project URL 與 Publishable key），見 docs/architecture.md 第 8 節
    const url = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) {
      throw new Error('VITE_BACKEND=supabase，但缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY');
    }
    return { service: createSupabaseChatService({ url, publishableKey }), mockControls: null };
  }
  throw new Error(`不認識的後端：${backend}（只能是 mock 或 supabase）`);
}

const created = create();

export const chatService: ChatService = created.service;
/** 只有模擬器才有；給 ?debug 的遙控面板用 */
export const mockControls: MockControls | null = created.mockControls;
export type { ChatService } from './ChatService';
