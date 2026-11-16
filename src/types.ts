// クライアントと Worker で共有するデータ型・選択肢

export type Status = "pain" | "easing" | "gone";
export const STATUSES: Status[] = ["pain", "easing", "gone"];

export type Weather = {
  at: number; // 気象データの時刻（ms）
  pressure: number; // 海面気圧 hPa
  d3h: number | null; // 3 時間前からの変化 hPa
  d24h: number | null; // 24 時間前からの変化 hPa
  trend?: number | null; // 日内変動（潮汐）を除いた 6 時間あたりの変化 hPa
  temp: number | null;
  humidity: number | null;
  code: number | null; // WMO 天気コード
  place?: string;
  lat: number;
  lon: number;
};

export type MedEffect = "good" | "some" | "none";

// headache = 頭痛の記録 / clear = 頭痛のなかった日 / midas = 生活への支障度の回答
export type Kind = "headache" | "clear" | "midas" | "workout";
export const kindOf = (e: { kind?: Kind }): Kind => e.kind ?? "headache";

export type Entry = {
  id: string;
  kind?: Kind;
  prodromes?: string[]; // 前ぶれ
  midas?: number[]; // MIDAS 5 問の日数
  memo: string;
  status: Status;
  startedAt: number;
  endedAt: number | null;
  intensity: 0 | 1 | 2 | 3; // 0 = 未入力
  meds: string[];
  medEffect: MedEffect | null;
  sleepLack: boolean;
  triggers: string[];
  symptoms: string[];
  weather: Weather | null;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
};

export const TRIGGERS = [
  "天気・気圧",
  "ストレス",
  "生理",
  "空腹",
  "アルコール",
  "カフェイン",
  "光・音・におい",
  "PC・スマホ",
  "肩こり",
  "人混み",
  "寝すぎ",
  "運動",
];

export const SYMPTOMS = ["前兆", "吐き気", "光がつらい", "音がつらい", "ズキズキ", "片側", "動くと悪化", "めまい", "押すと痛い"];

// 頭痛の数時間〜1日前に出やすい前ぶれ（予兆期）
export const PRODROMES = ["あくび", "首・肩のこり", "眠気", "甘いものが欲しい", "イライラ", "だるさ", "集中しにくい", "むくみ"];

// 生活への支障度（MIDAS：過去3か月で、頭痛のために…の日数）
export const MIDAS_QUESTIONS = [
  "仕事や学校を休んだ日",
  "仕事や学校の効率が半分以下になった日（休んだ日を除く）",
  "家事ができなかった日",
  "家事の効率が半分以下になった日（できなかった日を除く）",
  "家族・友人との予定や趣味をあきらめた日",
];
export function midasGrade(score: number) {
  if (score <= 5) return { g: "I", label: "支障はほとんどない" };
  if (score <= 10) return { g: "II", label: "軽い支障" };
  if (score <= 20) return { g: "III", label: "中くらいの支障" };
  return { g: "IV", label: "大きな支障" };
}

export const INTENSITY = [
  { v: 1, label: "軽い", hint: "普段どおり動ける" },
  { v: 2, label: "中くらい", hint: "支障がある" },
  { v: 3, label: "強い", hint: "寝込む" },
] as const;
