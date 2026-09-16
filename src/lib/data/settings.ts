/**
 * 企業設定（仕様書 6.3）。
 *
 * システムは変更を禁止しない。ただし機能不全に近づく方向の変更には
 * 警告を出してから適用する。管理者を疑う機能ではなく、管理者を守る機能。
 *
 * 6.3 を実装するときの下地。現状どこからも参照していない（未実装、README 参照）。
 */

export type Settings = {
  /** 配信間隔（日）。デフォルト週1。システム上限は月1（=31日）まで */
  deliveryIntervalDays: number;
  /** 1配信あたりの件数上限。超過分は次回に繰り越す（仕様書 5.1） */
  maxPerDelivery: number;
  /** 送信レート制限（日あたり件数）（仕様書 4.2） */
  rateLimitPerDay: number;
  /** レート制限の単位 */
  rateLimitUnit: "perTarget" | "perSender";
  /** 閾値：具体的な行動が抽出できた申告。異なる人数（仕様書 3.3） */
  thresholdConcrete: number;
  /** 閾値：曖昧な申告。異なる人数 */
  thresholdVague: number;
  /** 曖昧な申告の集計期間（日） */
  thresholdVagueWindowDays: number;
  /** 部署アラートの母数下限。これ未満の部署では出さない（仕様書 6.2） */
  deptAlertMinMembers: number;
};

export const DEFAULT_SETTINGS: Settings = {
  deliveryIntervalDays: 7,
  maxPerDelivery: 3,
  rateLimitPerDay: 1,
  rateLimitUnit: "perTarget",
  thresholdConcrete: 2,
  thresholdVague: 3,
  thresholdVagueWindowDays: 90,
  deptAlertMinMembers: 5,
};

/** システム上限。これを超える設定は保存しない（仕様書 5.1） */
export const MAX_DELIVERY_INTERVAL_DAYS = 31;

export type SettingWarning = {
  field: keyof Settings;
  message: string;
};

/**
 * 機能不全に近づく方向の変更を検出する。
 * 対象は「配信頻度を延ばす」「レートを絞る」「閾値を上げる」の3方向（仕様書 6.3）。
 * 禁止はしない。警告を返すだけで、適用するかは管理者が決める。
 */
export function warningsFor(current: Settings, next: Settings): SettingWarning[] {
  const w: SettingWarning[] = [];

  if (next.deliveryIntervalDays > current.deliveryIntervalDays) {
    w.push({
      field: "deliveryIntervalDays",
      message: `配信が ${next.deliveryIntervalDays} 日ごとになります。間隔が延びるほど、送った内容が相手に届くまで時間がかかります。相談体制として機能しない可能性があります。`,
    });
  }

  if (next.rateLimitPerDay < current.rateLimitPerDay) {
    w.push({
      field: "rateLimitPerDay",
      message: `1日に送れる件数が ${next.rateLimitPerDay} 件までになります。送信のハードルが上がり、声が上がりにくくなる可能性があります。`,
    });
  }

  if (next.maxPerDelivery < current.maxPerDelivery) {
    w.push({
      field: "maxPerDelivery",
      message: `1回の配信で届く件数が ${next.maxPerDelivery} 件までになります。繰り越しが溜まり、届くまでに時間がかかる可能性があります。`,
    });
  }

  if (next.thresholdConcrete > current.thresholdConcrete) {
    w.push({
      field: "thresholdConcrete",
      message: `複数人からの申告として扱う人数が ${next.thresholdConcrete} 人になります。パターンとして検出されるまでに時間がかかります。`,
    });
  }

  if (next.thresholdVague > current.thresholdVague) {
    w.push({
      field: "thresholdVague",
      message: `曖昧な申告の閾値が ${next.thresholdVague} 人になります。組織の問題が表面化しにくくなる可能性があります。`,
    });
  }

  if (next.deptAlertMinMembers > current.deptAlertMinMembers) {
    w.push({
      field: "deptAlertMinMembers",
      message: `部署アラートの母数下限が ${next.deptAlertMinMembers} 人になります。小さい部署の問題が集計されなくなります。`,
    });
  }

  return w;
}
