"use client";

import { useEffect, useState } from "react";
import { adminAction, deliverAction, seedDemoAction, type AdminView } from "@/app/actions";
import { Btn, Field, Notice } from "./ui";

/**
 * 管理者画面（仕様書 6 章）。
 *
 * 出すのは判断材料まで。推奨アクションは出さない（6.1「対処の責任範囲」）。
 * 数字を見せれば誰でも動いてしまう、という構造の問題があるため（6.4）、
 * 件数の粒度は「申告者が推測されない」側に倒して選んでいる。
 *   - 重大度の内訳は全社の合計だけ。部署 × 重大度の表は作らない
 *   - 部署アラートは件数を出さず「複数の申告」とだけ言う（6.2「件数非表示」）
 *   - 申告者の氏名は出さない。実名が出るのは本人が同意した人事引き継ぎだけ
 */

/** 5 段階の目盛り。申告ゼロの部署には表示しない。
 * 空の目盛りを出すと「レベル0＝安全」に見え、「データなし」と区別がつかなくなるため。 */
function Meter({ level, max }: { level: number; max: number }) {
  return (
    <div style={{ display: "flex", gap: 3 }} aria-hidden>
      {Array.from({ length: max }, (_, i) => {
        const on = i + 1 <= level;
        return (
          <span
            key={i}
            style={{
              width: 18,
              height: 8,
              borderRadius: 3,
              background: on ? levelColor(level) : "var(--line)",
              boxShadow: on
                ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(13,32,42,0.25)"
                : "inset 0 1px 2px rgba(13,32,42,0.12)",
            }}
          />
        );
      })}
    </div>
  );
}

/** 5 が最も危険。上に行くほど強い色にする */
function levelColor(level: number): string {
  return level >= 4 ? "var(--stop)" : level >= 3 ? "var(--copper)" : "var(--brand)";
}

/** 配信の予定は日本時間で見せる。ブラウザの時間帯に引きずられると曜日がずれる */
function formatDelivery(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value">{children}</div>
    </div>
  );
}

export default function Admin({ onChanged }: { onChanged?: () => void }) {
  const [view, setView] = useState<AdminView | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    const r = await adminAction();
    if (r.ok) setView(r.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const deliver = async () => {
    setDelivering(true);
    const r = await deliverAction();
    if (r.ok) setView(r.data);
    setDelivering(false);
    onChanged?.();
  };

  const seed = async () => {
    setSeeding(true);
    const r = await seedDemoAction();
    if (r.ok) setView(r.data);
    setSeeding(false);
    onChanged?.();
  };

  if (!view) {
    return <p className="fineprint">読み込んでいます…</p>;
  }

  const { delivery, severityMix, levelMax } = view;
  const alerted = view.depts.filter((d) => d.alert);
  const isEmpty = view.pending === 0 && delivery.deliveredTotal === 0 && view.escalations.length === 0;

  return (
    <div>
      {isEmpty && (
        <Notice tone="quiet" title="まだ申告がありません" className="mb-6">
          この画面は、申告が届くとここから埋まっていきます。動かして確かめるなら、
          いちばん下の「デモ用データを入れる」から、名簿6人ぶんのサンプルを入れられます。
        </Notice>
      )}

      {/* 配信の状態（仕様書 5.1）。即時配信はしないので、次がいつかを必ず出す */}
      <div
        className="card card--raised"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div>
          {/* この入れ子は E2E が「N件 未配信」として読む。中に他の文字を足さない */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.45rem" }}>
            <span className={view.pending === 0 ? "stat stat--hero stat--zero" : "stat stat--hero"}>
              {view.pending}
            </span>
            <span className="body-text">件 未配信</span>
          </div>
          <p className="fineprint" style={{ color: "var(--sub)" }}>
            本番は毎週月曜に自動配信。デモではここから手動で配信します
          </p>
        </div>
        <Btn variant="accent" onClick={deliver} disabled={view.pending === 0 || delivering}>
          {delivering ? "配信しています…" : "いま配信する"}
        </Btn>
        {/* 押すと何が起きるかを押す前に出す。配信は取り消しの締め切りでもある（送信者は
            配信前しか取り消せない）ので、件数とあわせて必ず書く */}
        {view.pending > 0 && (
          <p className="fineprint" style={{ flexBasis: "100%", margin: 0, color: "var(--sub)" }}>
            押すと未配信の {view.pending} 件がまとめて届きます。届いたあとは、送信者が自分で取り消すことはできなくなります。
          </p>
        )}
      </div>

      <div className="metrics" style={{ marginTop: "0.75rem" }}>
        <Metric label="次のまとめ配信">
          <span style={{ fontSize: "0.92rem", fontWeight: 700 }}>
            {formatDelivery(delivery.nextAt)}
          </span>
        </Metric>
        <Metric label="配信の間隔">
          <span className="stat stat--mini">{delivery.intervalDays}</span>
          <span className="metric__unit">日ごと</span>
        </Metric>
        <Metric label="いちばん古い未配信">
          {delivery.oldestPendingDays === null ? (
            <span className="metric__unit">なし</span>
          ) : (
            <>
              <span className="stat stat--mini">{delivery.oldestPendingDays}</span>
              <span className="metric__unit">日前から</span>
            </>
          )}
        </Metric>
        <Metric label="配信済みの累計">
          <span className="stat stat--mini">{delivery.deliveredTotal}</span>
          <span className="metric__unit">件</span>
        </Metric>
      </div>

      <h2 className="label" style={{ margin: "2.25rem 0 0.9rem" }}>
        配信済みの重大度の内訳
      </h2>

      <div className="metrics">
        <Metric label="レベル1（単発の言動など）">
          <span className="stat stat--mini">{severityMix.level1}</span>
          <span className="metric__unit">件</span>
        </Metric>
        <Metric label="レベル2（継続的な言動など）">
          <span className="stat stat--mini" style={{ color: "var(--copper)" }}>
            {severityMix.level2}
          </span>
          <span className="metric__unit">件</span>
        </Metric>
        <Metric label="レベル3（暴力・脅迫など）">
          <span className="metric__unit">送信せず、人事への引き継ぎへ</span>
        </Metric>
      </div>

      <p className="fineprint" style={{ marginTop: "0.9rem", maxWidth: "36rem", color: "var(--sub)" }}>
        全社の合計だけを出します。部署ごとに件数を割ると、小さな組織では誰の申告かが推測できてしまうためです。
        レベル3はこのツールでは送信を止め、本人が同意したときだけ人事へ引き継ぐため、ここには入りません。
      </p>

      <h2 className="label" style={{ margin: "2.25rem 0 0.35rem" }}>
        部署ごとの状態
      </h2>
      <p className="lede" style={{ marginBottom: "0.9rem" }}>
        5 段階で、5 が最も危険。部署どうしの順位は付けません。
        申告の重大度レベル（上の内訳）とは別の指標です。
      </p>

      {alerted.length > 0 && (
        <Notice tone="stop" title="部署アラート" className="mb-3">
          {`${alerted.map((d) => d.dept).join("・")}で、複数の申告が集まっています。件数と原文は出しません。`}
          この通知は、その部署の管理者を飛ばして一段上へ送ります。原因が部署長にある場合、本人に上げても意味がないためです。
        </Notice>
      )}

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {view.depts.map((e) => (
          <div key={e.dept} className={`card dept-card ${e.alert ? "dept-card--alert" : ""}`}>
            {/* 部署名と内訳の組。E2E がこの組を読むので、ここに段落をもう一つ足さない */}
            <div style={{ flex: "1 1 13rem", minWidth: "11rem" }}>
              <div className="dept-name">{e.dept}</div>
              <p className="dept-detail">{e.detail}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}>
                {e.alert && <span className="badge badge--alert">部署アラート</span>}
                {e.belowMinMembers && (
                  <span className="badge">在籍 {e.memberCount} 人 ・ 部署単位では判断しない</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
              {e.level === null ? (
                <span className="level__none">データなし</span>
              ) : (
                <>
                  <Meter level={e.level} max={levelMax} />
                  {/* 「レベル N」とは書かない。「レベル」は申告の重大度を指す語で、送信画面の
                      「レベル3＝このツールでは扱えない」と取り違えられる（label 自体も
                      backend で「5 段階中 N」にしてある） */}
                  <span className="level" aria-label={`${e.label}（${levelMax} が最も危険）`}>
                    <span className="level__scale">{levelMax} 段階中</span>
                    <span className="level__num" style={{ color: levelColor(e.level) }}>
                      {e.level}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="fineprint" style={{ marginTop: "1.5rem", maxWidth: "36rem", color: "var(--sub)" }}>
        申告がゼロの部署は「データなし」と表示します。健全なのか、誰も声を上げられないのかは、この数字だけでは区別できないためです。
        集計するのは配信済みの申告だけです。送信直後に数字が動くと、誰が書いたか推測されてしまうためです。
        在籍人数が {view.deptAlertMinMembers} 人に満たない部署では、部署単位のアラートを出しません。少人数で発火させると、誰が書いていないかを探す動きを招くためです。
        各部署にこの評価は開示されません。
      </p>

      <h2 className="label" style={{ margin: "2.25rem 0 0.35rem" }}>
        人事への引き継ぎ{view.escalations.length > 0 && `（${view.escalations.length} 件）`}
      </h2>
      <p className="lede" style={{ marginBottom: "0.9rem" }}>
        この画面で唯一、申告者の実名と原文が出ます。匿名の申告とは扱いが違います。
      </p>

      {view.escalations.length === 0 ? (
        <p className="fineprint">ありません</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {view.escalations.map((e) => (
            <article key={e.id} className="card card--heavy" style={{ padding: "1.25rem 1.375rem" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "0.5rem 1rem",
                }}
              >
                <span style={{ fontSize: "1rem", fontWeight: 700 }}>{e.authorName}</span>
                <span className="fineprint">{new Date(e.createdAt).toLocaleString("ja-JP")}</span>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <span className="badge badge--alert">実名・原文</span>
              </div>
              <div style={{ display: "grid", gap: "0.9rem", marginTop: "0.9rem" }}>
                <Field label="判定理由">{e.severityReason}</Field>
                <Field label="本人が書いた内容">{e.rawBody}</Field>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="fineprint" style={{ marginTop: "1.5rem", maxWidth: "36rem", color: "var(--sub)" }}>
        本人が実名での引き継ぎに同意したものだけが表示されます。匿名の申告とは別に扱い、部署ごとの状態には含めません。
      </p>

      <div
        className="card"
        style={{
          marginTop: "2.25rem",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div style={{ flex: "1 1 16rem" }}>
          <div style={{ fontSize: "0.92rem", fontWeight: 700 }}>デモ用のサンプルデータ</div>
          <p className="fineprint" style={{ color: "var(--sub)" }}>
            名簿6人ぶんの申告を、複数の部署・重大度・配信済み／未配信が混ざる形で入れ直します。いまのデータは消えます。
          </p>
        </div>
        <Btn variant="ghost" onClick={seed} disabled={seeding}>
          {seeding ? "入れています…" : "デモ用データを入れる"}
        </Btn>
      </div>
    </div>
  );
}
