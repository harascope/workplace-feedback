export type Power = "peer" | "manager" | "executive";

export type User = {
  id: string;
  name: string;
  dept: string;
  title: string;
  power: Power;
};

/** デモ用の社員名簿。認証の代わりに人物セレクタで切り替える。 */
export const USERS: User[] = [
  { id: "u1", name: "山田 太郎", dept: "営業部", title: "メンバー", power: "peer" },
  { id: "u2", name: "佐藤 健一", dept: "営業部", title: "部長", power: "manager" },
  { id: "u3", name: "鈴木 花子", dept: "営業部", title: "メンバー", power: "peer" },
  { id: "u4", name: "高橋 みどり", dept: "開発部", title: "メンバー", power: "peer" },
  { id: "u5", name: "田中 誠", dept: "管理部", title: "役員", power: "executive" },
];

export const userById = (id: string): User | undefined => USERS.find((u) => u.id === id);

export const DEPTS = Array.from(new Set(USERS.map((u) => u.dept)));

/** 自動送信のデフォルトが OFF になる相手（仕様書 3.4）。送信自体は止めない。 */
export const isPowerSensitive = (u: User): boolean => u.power === "manager" || u.power === "executive";
