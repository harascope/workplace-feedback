export type Power = "peer" | "manager" | "executive";

export type User = {
  id: string;
  name: string;
  dept: string;
  title: string;
  power: Power;
  /** HR 担当者かどうか。この人物が対象のときは HR 通知をバイパスする（仕様書 3.4） */
  isHR?: boolean;
};

/** デモ用の社員名簿。認証の代わりに人物セレクタで切り替える。 */
export const USERS: User[] = [
  { id: "u1", name: "山田 太郎", dept: "営業部", title: "メンバー", power: "peer" },
  { id: "u2", name: "佐藤 健一", dept: "営業部", title: "部長", power: "manager" },
  { id: "u3", name: "鈴木 花子", dept: "営業部", title: "メンバー", power: "peer" },
  { id: "u4", name: "高橋 みどり", dept: "開発部", title: "メンバー", power: "peer" },
  { id: "u5", name: "田中 誠", dept: "管理部", title: "役員", power: "executive" },
  { id: "u6", name: "伊藤 彩", dept: "管理部", title: "人事担当", power: "peer", isHR: true },
];

export const userById = (id: string): User | undefined => USERS.find((u) => u.id === id);

const surname = (u: User): string => u.name.split(" ")[0];

/** AI が読み取った対象者の手がかり（「佐藤さん」など）を、候補の人物に姓で突き合わせる */
export const userFromHint = (hint: string, candidates: User[]): User | undefined =>
  candidates.find((u) => hint.includes(surname(u)));

/**
 * 文中のどこかに人事担当の姓が出ていれば、その人物を返す。
 * 人事への引き継ぎを止める判定に使う。対象者の読み取りが外れたり複数名が書かれていても、
 * 当事者に届く側へは倒さないよう、手がかりの先頭一致には頼らない。
 */
export const hrMentionedIn = (text: string, candidates: User[]): User | undefined =>
  candidates.find((u) => u.isHR && text.includes(surname(u)));

export const DEPTS = Array.from(new Set(USERS.map((u) => u.dept)));

/** 自動送信のデフォルトが OFF になる相手（仕様書 3.4）。送信自体は止めない。 */
export const isPowerSensitive = (u: User): boolean => u.power === "manager" || u.power === "executive";

/**
 * 送信先に応じた経路（仕様書 3.4）。
 * HR 担当者自身が対象のとき、HR 通知を経由すると当事者に届いてしまうため、
 * 社外窓口のみを案内する。この経路が無いとツールが機能不全になる。
 */
export type Route = {
  /** 自動送信のデフォルトを OFF にするか */
  autoSendOff: boolean;
  /** HR への通知をバイパスするか */
  bypassHR: boolean;
  /** 画面に出す注意文。null なら注意不要 */
  notice: string | null;
  /** 社外窓口を優先案内するか */
  preferExternal: boolean;
};

export function routeFor(target: User): Route {
  if (target.isHR) {
    return {
      autoSendOff: true,
      bypassHR: true,
      preferExternal: true,
      notice:
        "この相手は人事担当です。人事を経由した相談は、相手本人に届くことになります。この送信は人事へ通知されません。社外の窓口に相談することも検討してください。",
    };
  }
  if (target.power === "executive") {
    return {
      autoSendOff: true,
      bypassHR: false,
      preferExternal: true,
      notice:
        "役員への匿名フィードバックは、報復のリスクが高くなります。この設定では自動送信が既定でオフになっていますが、送ることはできます。社外の窓口もあわせて案内します。",
    };
  }
  if (target.power === "manager") {
    return {
      autoSendOff: true,
      bypassHR: false,
      preferExternal: false,
      notice:
        "直属の上司にあたる相手への匿名フィードバックは、報復のリスクが高くなります。この設定では自動送信が既定でオフになっていますが、送ることはできます。",
    };
  }
  return { autoSendOff: false, bypassHR: false, preferExternal: false, notice: null };
}

/** 外部相談窓口。レベル3および権力差の大きい相手で案内する */
export const EXTERNAL_CONTACTS = [
  "各都道府県労働局 総合労働相談コーナー",
  "警察相談専用電話 #9110",
  "法テラス（弁護士相談）",
];
