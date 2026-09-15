import { describe, expect, it } from "vitest";
import { USERS, hrMentionedIn, isPowerSensitive, routeFor, userById, userFromHint, type User } from "./users";

const u = (id: string): User => userById(id)!;

const person = (over: Partial<User> & Pick<User, "id" | "name">): User => ({
  dept: "営業部",
  title: "メンバー",
  power: "peer",
  ...over,
});

describe("userFromHint", () => {
  it("フルネームで一致する（空白の有無は問わない）", () => {
    expect(userFromHint("佐藤 健一", USERS)?.id).toBe("u2");
    expect(userFromHint("佐藤健一さん", USERS)?.id).toBe("u2");
  });

  it("姓が1人だけ一致すれば、その人を返す", () => {
    expect(userFromHint("佐藤部長", USERS)?.id).toBe("u2");
  });

  it("同じ姓が2人いると決めつけず undefined", () => {
    const candidates = [...USERS, person({ id: "x1", name: "佐藤 次郎" })];

    expect(userFromHint("佐藤さん", candidates)).toBeUndefined();
    // フルネームなら同姓がいても決まる
    expect(userFromHint("佐藤 次郎", candidates)?.id).toBe("x1");
  });

  it("空文字では誰にも一致しない", () => {
    expect(userFromHint("", USERS)).toBeUndefined();
  });

  it("候補に居ない人は返さない", () => {
    const withoutSato = USERS.filter((x) => x.id !== "u2");
    expect(userFromHint("佐藤部長", withoutSato)).toBeUndefined();
  });
});

describe("hrMentionedIn", () => {
  it("本文のどこかに人事担当の姓があれば、人事担当を返す", () => {
    expect(hrMentionedIn("佐藤部長と伊藤さんに殴られた", USERS)?.id).toBe("u6");
  });

  it("同じ姓の一般社員が先に並んでいても、人事担当を返す", () => {
    const candidates = [person({ id: "x2", name: "伊藤 翔" }), ...USERS];
    expect(hrMentionedIn("伊藤さんに殴られた", candidates)?.id).toBe("u6");
  });

  it("人事担当の姓が無ければ undefined", () => {
    expect(hrMentionedIn("上司に殴られた", USERS)).toBeUndefined();
    expect(hrMentionedIn("", USERS)).toBeUndefined();
  });
});

describe("routeFor", () => {
  it("人事担当: 人事への通知を迂回し、社外窓口を案内する", () => {
    const r = routeFor(u("u6"));
    expect(r).toMatchObject({ bypassHR: true, autoSendOff: true, preferExternal: true });
    expect(r.notice).toEqual(expect.any(String));
  });

  it("人事担当であることが役職より優先される", () => {
    const r = routeFor(person({ id: "x3", name: "人事 役員", power: "executive", isHR: true }));
    expect(r.bypassHR).toBe(true);
  });

  it("役員: 自動送信オフ、社外窓口も案内、人事は迂回しない", () => {
    const r = routeFor(u("u5"));
    expect(r).toMatchObject({ bypassHR: false, autoSendOff: true, preferExternal: true });
    expect(r.notice).toEqual(expect.any(String));
  });

  it("部長: 自動送信オフだけ", () => {
    const r = routeFor(u("u2"));
    expect(r).toMatchObject({ bypassHR: false, autoSendOff: true, preferExternal: false });
    expect(r.notice).toEqual(expect.any(String));
  });

  it("一般社員: 注意なし", () => {
    expect(routeFor(u("u1"))).toEqual({
      autoSendOff: false,
      bypassHR: false,
      preferExternal: false,
      notice: null,
    });
  });
});

describe("isPowerSensitive", () => {
  it("部長と役員だけが対象", () => {
    expect(isPowerSensitive(u("u2"))).toBe(true);
    expect(isPowerSensitive(u("u5"))).toBe(true);
    expect(isPowerSensitive(u("u1"))).toBe(false);
    expect(isPowerSensitive(u("u6"))).toBe(false);
  });
});
