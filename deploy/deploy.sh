#!/usr/bin/env bash
# workplace-feedback を gpa-prod VM へデプロイする。何度実行してもよい。
# トンネル（cloudflared.yml）と DNS の登録は初回だけの作業なので、ここには入れていない（README「デプロイ」参照）。
set -euo pipefail

VM="${VM:-ubuntu@192.168.0.220}"
REMOTE_DIR="${REMOTE_DIR:-/opt/workplace-feedback}"
PROJECT="workplace-feedback"
IMAGE="workplace-feedback"

cd "$(dirname "$0")/.."

die() {
  echo "エラー: $*" >&2
  exit 1
}

# 1. どの版を出したか後から分かるように、クリーンな作業ツリーの sha をタグにする
[ -z "$(git status --porcelain)" ] || die "作業ツリーに未コミットの変更がある。コミットしてから実行する"
TAG="$(git rev-parse --short HEAD)"
echo "==> タグ: ${TAG}"

# 2. ローカルでビルドする。VM のメモリでは next build が落ちる恐れがあるため
echo "==> イメージをビルドする: ${IMAGE}:${TAG}"
docker build -t "${IMAGE}:${TAG}" . || die "docker build に失敗した"

echo "==> イメージを ${VM} へ送る"
docker save "${IMAGE}:${TAG}" | gzip | ssh "${VM}" 'gunzip | docker load' ||
  die "イメージの転送に失敗した。ssh ${VM} が通るか確認する"

# 3. compose と .env を置く。/opt は root 所有なので、初回だけ sudo で作って持ち主を移す。
#    鍵を書いた secrets.env はここでは作らないし、触らない（.env に書くのは TAG だけ）
echo "==> ${REMOTE_DIR} に compose と .env を置く"
ssh "${VM}" "[ -d ${REMOTE_DIR} ] || { sudo mkdir -p ${REMOTE_DIR} && sudo chown ubuntu:ubuntu ${REMOTE_DIR}; }" ||
  die "${REMOTE_DIR} を作れなかった"
scp -q deploy/docker-compose.yml "${VM}:${REMOTE_DIR}/docker-compose.yml" || die "compose を送れなかった"
echo "TAG=${TAG}" | ssh "${VM}" "cat > ${REMOTE_DIR}/.env" || die ".env を書けなかった"

# 4. 起動する。プロジェクト名は必ず明示する（他の相乗りアプリとの衝突を避けるため）
echo "==> 起動する"
ssh "${VM}" "cd ${REMOTE_DIR} && docker compose -p ${PROJECT} up -d" || die "docker compose up に失敗した"

# 5. healthy になるまで待つ
echo "==> healthy になるまで待つ"
CID="$(ssh "${VM}" "cd ${REMOTE_DIR} && docker compose -p ${PROJECT} ps -q feedback")"
[ -n "${CID}" ] || die "コンテナが見つからない"
for _ in $(seq 1 60); do
  STATUS="$(ssh "${VM}" "docker inspect -f '{{.State.Health.Status}}' ${CID}" 2>/dev/null || echo unknown)"
  case "${STATUS}" in
    healthy)
      echo "==> healthy"
      break
      ;;
    unhealthy)
      ssh "${VM}" "docker logs --tail 50 ${CID}" || true
      die "コンテナが unhealthy になった"
      ;;
  esac
  sleep 2
done
[ "${STATUS:-}" = "healthy" ] || {
  ssh "${VM}" "docker logs --tail 50 ${CID}" || true
  die "120 秒待っても healthy にならなかった（最後の状態: ${STATUS:-unknown}）"
}

# 6. 古いイメージを片付ける。今の版と1つ前だけ残す（戻せるように）
echo "==> 古いイメージを片付ける"
ssh "${VM}" "docker images --filter=reference='${IMAGE}' --format '{{.Repository}}:{{.Tag}}' | tail -n +3 | xargs -r docker rmi" || true

echo "==> 完了: ${IMAGE}:${TAG}"
echo "    確認: ssh ${VM} \"docker exec ${CID} node -e \\\"fetch('http://127.0.0.1:3000/').then(r=>console.log(r.status))\\\"\""
