import type { Message } from '../ChatService';

/** 假後台裡的機器人（讓畫面不會是空的）。名字也會被當作「已有人在用」的代號。 */
export interface Bot {
  id: string;
  nickname: string;
}

export const BOTS: Bot[] = [
  { id: 'bot-xiaomei', nickname: '小美' },
  { id: 'bot-azhe', nickname: '阿哲' },
  { id: 'bot-leo', nickname: 'Leo' },
  { id: 'bot-momo', nickname: 'Momo' },
];

export const BOT_LINES: string[] = [
  '今天天氣真好',
  '有人在嗎？',
  'Anyone up for a game tonight?',
  '剛剛那個連結你們看了嗎 https://example.com/post/42',
  '哈哈哈哈',
  '我先去吃飯，晚點回來',
  'Good morning, everyone!',
  'Bonne idée, à ce soir !',
  '推薦一部好看的電影給我',
  '收到 👍',
  '有人想一起打遊戲嗎？',
  'See you all tomorrow',
];

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 設計稿裡那張示意圖：藍天、太陽、綠山 */
export const SAMPLE_IMAGE = svgDataUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 150"><rect width="220" height="150" fill="#86d8ff"/>' +
    '<circle cx="165" cy="42" r="20" fill="#ffd447" stroke="#1f1a3d" stroke-width="3"/>' +
    '<path d="M0 150V100l50-45 40 38 35-26 95 63v20z" fill="#62e0a8" stroke="#1f1a3d" stroke-width="3" stroke-linejoin="round"/></svg>',
);

export const SAMPLE_THUMB = svgDataUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 110"><rect width="300" height="110" fill="#e4f6ff"/>' +
    '<path d="M0 110V80l60-40 50 30 45-20 80 50v10z" fill="#ffd447" stroke="#1f1a3d" stroke-width="3" stroke-linejoin="round"/></svg>',
);

function at(daysAgo: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

let n = 0;
function text(bot: Bot, createdAt: string, body: string, status: Message['status'] = 'normal'): Message {
  n++;
  return {
    id: `seed-${n}`,
    senderId: bot.id,
    nickname: bot.nickname,
    kind: 'text',
    text: status === 'retracted' ? null : body,
    image: null,
    createdAt,
    status,
  };
}

/** 第一次打開時放進去的歷史訊息（含跨日、連結、圖片、已收回、被遮住各一則） */
export function buildSeedHistory(): Message[] {
  n = 0;
  const [xm, az, leo, momo] = BOTS as [Bot, Bot, Bot, Bot];
  const list: Message[] = [
    text(az, at(1, 20, 12), '大家晚安，今天有人要通宵嗎？'),
    text(xm, at(1, 20, 14), '我可以，但我要先去洗澡 🛁'),
    text(leo, at(1, 20, 20), 'Count me in, I will bring snacks.'),
    text(az, at(1, 20, 31), '那九點見'),
    text(momo, at(1, 22, 5), '晚安～'),
    text(az, minutesAgo(52), '早安！昨天好像有人沒睡 😂'),
    text(xm, minutesAgo(50), '有人看過這個嗎？ https://example.com/post/42'),
    text(leo, minutesAgo(47), 'Anyone up for a game tonight?'),
    text(momo, minutesAgo(40), '我傳錯了', 'retracted'),
    text(az, minutesAgo(33), '這是一則因為多人檢舉而被遮住的訊息', 'hidden'),
    text(xm, minutesAgo(21), 'Bonne idée, à ce soir !'),
  ];
  list.push({
    id: 'seed-image',
    senderId: leo.id,
    nickname: leo.nickname,
    kind: 'image',
    text: null,
    image: { url: SAMPLE_IMAGE, width: 440, height: 300 },
    createdAt: minutesAgo(12),
    status: 'normal',
  });
  list.push(text(az, minutesAgo(8), '哈哈 這張好可愛'));
  return list;
}
