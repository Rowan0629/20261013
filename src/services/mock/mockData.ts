import type { Message } from '../../types';

// 階段一的假資料：假的使用者、假的對話、假的歷史訊息。

/** 一開始就在線上的假使用者。小花與阿哲不會離開，方便測試「代號被占用」 */
export const ALWAYS_ONLINE = ['小花', '阿哲'];
export const INITIAL_ONLINE = [
  ...ALWAYS_ONLINE,
  'Amy',
  '大雄',
  '小美',
  'Kevin88',
  '阿凱',
  '小宇',
  'Rita',
  '老王',
  '阿德',
];
/** 會隨機進出的備用名單 */
export const EXTRA_BOTS = ['小琪', 'Jason', '阿豪'];
export const ALL_BOTS = [...INITIAL_ONLINE, ...EXTRA_BOTS];

export const PHRASES = [
  '大家早安～',
  '有人要一起訂午餐嗎？',
  '今天天氣真好',
  '哈哈哈哈哈哈',
  '我剛剛看到一個超好笑的東西',
  '明天記得帶筆電',
  '週五的活動有人要報名嗎？',
  '下午三點在一樓集合喔',
  '收到，我會準時到',
  '+1',
  '有人看過那部新電影嗎？',
  '推薦一家咖啡店，在巷子裡面，很安靜',
  '剛下班，累死了',
  '晚上要不要一起玩遊戲？',
  '我也要！',
  '等一下再說，我先去開會',
  '這個週末有人要去爬山嗎？',
  '謝謝大家的幫忙 🙏',
  '對耶，我也這麼覺得',
  '笑死 😂',
  '中午吃什麼好煩惱',
  '今天的便當看起來不錯',
  '晚安，明天見～',
  '剛剛那個問題我查到答案了，原來是設定的問題，改完就好了',
  '好啊，那就這樣決定囉',
  '有人知道這附近哪裡有停車位嗎？',
  '我先去忙，晚點回來看',
  '恭喜恭喜！🎉',
  '太棒了',
  '同意',
];

/** 簡單的可重現亂數：每次載入都產生同樣的歷史，比較好除錯 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES = [
  { sky: '#CFE0F5', sun: '#F7C948', far: '#6FA58A', near: '#4B8268' },
  { sky: '#F6D9C8', sun: '#FFF3C4', far: '#C97B5A', near: '#8E4F3A' },
  { sky: '#D5D0F0', sun: '#FFE29A', far: '#7C6FB5', near: '#54488A' },
  { sky: '#CDEBE4', sun: '#F5C84C', far: '#4FA08A', near: '#2F7664' },
];

/** 假圖片：一張山景插圖（SVG），不需要真的檔案 */
export function sampleImage(seed: number): string {
  const p = PALETTES[Math.abs(seed) % PALETTES.length]!;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 150" width="880" height="600">` +
    `<rect width="220" height="150" fill="${p.sky}"/>` +
    `<circle cx="165" cy="42" r="18" fill="${p.sun}"/>` +
    `<path d="M0 150V100l50-45 40 38 35-28 95 62v23z" fill="${p.far}"/>` +
    `<path d="M0 150v-30l60-30 60 40 100-20v40z" fill="${p.near}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 產生約 count 則歷史訊息（由舊到新），涵蓋今天、昨天與更早的日子 */
export function createHistory(count = 200): Message[] {
  const rand = mulberry32(20261013);
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
  const out: Message[] = [];
  let t = Date.now() - 4 * 60_000;
  for (let i = count - 1; i >= 0; i--) {
    const createdAt = new Date(t).toISOString();
    const nickname = pick(ALL_BOTS);
    const roll = rand();
    const base: Message = {
      id: `h_${String(i).padStart(4, '0')}`,
      userId: `bot:${nickname}`,
      nickname,
      text: pick(PHRASES),
      imageUrl: null,
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
    };
    if (roll < 0.07) {
      const at = new Date(t + 2 * 60_000).toISOString();
      out.push({ ...base, text: '', deletedAt: at, updatedAt: at });
    } else if (roll < 0.15) {
      const at = new Date(t + 60_000).toISOString();
      out.push({ ...base, editedAt: at, updatedAt: at });
    } else if (roll < 0.22) {
      out.push({ ...base, text: rand() < 0.5 ? '' : '你們看這張', imageUrl: sampleImage(i) });
    } else {
      out.push(base);
    }
    t -= Math.round((1 + rand() * 34) * 60_000);
  }
  return out.reverse();
}
