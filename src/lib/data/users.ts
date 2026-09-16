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

/**
 * AI が読み取った対象者の手がかり（「佐藤さん」など）を、候補の人物に突き合わせる。
 * フルネームで一致しなければ姓で探す。同じ姓が複数いるときは決めつけず、利用者に選ばせる。
 */
export const userFromHint = (hint: string, candidates: User[]): User | undefined => {
  const compact = hint.replace(/\s/g, "");
  const full = candidates.find((u) => compact.includes(u.name.replace(/\s/g, "")));
  if (full) return full;
  const bySurname = candidates.filter((u) => hint.includes(surname(u)));
  return bySurname.length === 1 ? bySurname[0] : undefined;
};

/**
 * 文中のどこかに人事担当の姓が出ていれば、その人物を返す。
 * 人事への引き継ぎを止める判定に使う。対象者の読み取りが外れたり複数名が書かれていても、
 * 当事者に届く側へは倒さないよう、手がかりの先頭一致には頼らない。
 * 姓だけで拾うので、同じ姓の一般社員がいても迂回する側に倒れる。
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
      notice: `${target.title}への匿名フィードバックは、報復のリスクが高くなります。そのため、この相手あては自動で送らない設定になっています。`,
    };
  }
  if (target.power === "manager") {
    return {
      autoSendOff: true,
      bypassHR: false,
      preferExternal: false,
      notice: `${target.title}への匿名フィードバックは、報復のリスクが高くなります。そのため、この相手あては自動で送らない設定になっています。`,
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
