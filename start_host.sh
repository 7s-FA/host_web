#!/usr/bin/env bash
set -eo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# 통합 폴더에서는 공통 환경·빌드·프로세스 관리를 사용합니다.
# 기존 웹 전용 실행 의미는 유지합니다. 전체 관제는 ../start_host.sh 사용.
if [[ -f ../scripts/host_env.bash && -f ../start_host.sh ]]; then
  exec bash ../start_host.sh --monitor-only "$@"
fi

if [[ ! -f /opt/ros/jazzy/setup.bash ]]; then
  echo 'ROS 2 Jazzy가 필요합니다: /opt/ros/jazzy/setup.bash' >&2
  exit 1
fi
source /opt/ros/jazzy/setup.bash

host_backend="${HOST_BACKEND_DIR:-$(cd .. && pwd)/host_backend}"
host_overlay="${HOST_OVERLAY:-$host_backend/install_local/local_setup.bash}"
if [[ ! -f "$host_overlay" ]]; then
  echo "Action 타입 빌드가 필요합니다: $host_overlay" >&2
  echo 'README의 «Host PC 한 번에 실행» 최초 준비를 먼저 실행하세요.' >&2
  exit 1
fi
source "$host_overlay"

export ROS_DOMAIN_ID="${HOST_ROS_DOMAIN_ID:-40}"
export RMW_IMPLEMENTATION="${HOST_RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"
export ROS_AUTOMATIC_DISCOVERY_RANGE="${HOST_DISCOVERY_RANGE:-SUBNET}"
unset ROS_LOCALHOST_ONLY ROS_STATIC_PEERS ROS_DISCOVERY_SERVER
exec ros2 launch "$PWD/host/host_control.launch.py"
