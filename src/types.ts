// クライアントと Worker で共有するデータ型・選択肢

export type Status = "pain" | "easing" | "gone";
export const STATUSES: Status[] = ["pain", "easing", "gone"];

export type Weather = {
  at: number; // 気象データの時刻（ms）
  pressure: number; // 海面気圧 hPa
  d3h: number | null; // 3 時間前からの変化 hPa
  d24h: number | null; // 24 時間前からの変化 hPa
  temp: number | null;
  humidity: number | null;
  code: number | null; // WMO 天気コード
  place?: string;
  lat: number;
  lon: number;
};

export type MedEffect = "good" | "some" | "none";

export type Entry = {
  id: string;
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

export const SYMPTOMS = ["前兆", "吐き気", "光がつらい", "音がつらい", "ズキズキ", "片側", "動くと悪化", "めまい"];

export const INTENSITY = [
  { v: 1, label: "軽い", hint: "普段どおり動ける" },
  { v: 2, label: "中くらい", hint: "支障がある" },
  { v: 3, label: "強い", hint: "寝込む" },
] as const;
