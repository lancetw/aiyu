#!/bin/bash
# 純診斷腳本：證明 Chrome 是否能成功 exec 我們的 binary
# 不做任何 native messaging 協定 — 只記錄一行就退出
{
  echo "=== $(date) ==="
  echo "argv: $*"
  echo "pwd: $(pwd)"
  echo "uid: $(id -u) gid: $(id -g)"
  echo "shell: $SHELL"
  echo "PATH: $PATH"
  echo "TMPDIR: $TMPDIR"
  echo "HOME: $HOME"
  env | sort
  echo "--- end ---"
} >> /Users/lancetw/Documents/pro_workspace/aiyu/host/diag.log 2>&1
exit 0
