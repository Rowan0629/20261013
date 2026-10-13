import type { ChatService } from './ChatService';
import { createMockChatService, type MockControls } from './mock/mockChatService';

// 這裡是「畫面用哪一種後端」唯一的切換點。
// 階段一只有模擬器；階段二在這裡加上 Supabase 版即可，畫面的程式碼完全不用動。
// 用 || 而不是 ??：GitHub Actions 讀不到的變數會變成「空字串」而不是「沒有」，空字串也要當作預設的 mock。
const backend = import.meta.env.VITE_BACKEND || 'mock';

function create(): { service: ChatService; mockControls: MockControls | null } {
  if (backend === 'mock') {
    const mock = createMockChatService();
    return { service: mock, mockControls: mock.controls };
  }
  throw new Error(`尚未支援的後端：${backend}（階段一只能用 mock）`);
}

const created = create();

export const chatService: ChatService = created.service;
/** 只有模擬器才有；給 ?debug 的遙控面板用 */
export const mockControls: MockControls | null = created.mockControls;
export type { ChatService } from './ChatService';
