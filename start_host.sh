#!/usr/bin/env bash
set -eo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ ! -f /opt/ros/jazzy/setup.bash ]]; then
  echo 'ROS 2 Jazzy가 필요합니다: /opt/ros/jazzy/setup.bash' >&2
  exit 1
fi
source /opt/ros/jazzy/setup.bash

host_overlay="$HOME/final_project_host/host_backend/install_local/local_setup.bash"
if [[ ! -f "$host_overlay" ]]; then
  echo "Action 타입 빌드가 필요합니다: $host_overlay" >&2
  echo 'README의 «Host PC 한 번에 실행» 최초 준비를 먼저 실행하세요.' >&2
  exit 1
fi
source "$host_overlay"

export ROS_DOMAIN_ID=40
export ROS_LOCALHOST_ONLY=0
exec ros2 launch "$PWD/host/host_control.launch.py"
