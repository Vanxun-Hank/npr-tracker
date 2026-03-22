#!/bin/bash
# ============================================================
#  NPR Tracker 一键部署脚本
#  适用于：腾讯云 / 阿里云 轻量服务器（Ubuntu 22.04/24.04）
#  推荐配置：香港区 2核4G（或以上）
#
#  用法：
#    1. 购买服务器后，SSH 登录
#    2. 把整个项目上传到服务器（见下方说明）
#    3. 运行: chmod +x deploy.sh && sudo ./deploy.sh
# ============================================================

set -e

echo "=========================================="
echo "  NPR Tracker 部署脚本"
echo "=========================================="

# ─── 1. 系统依赖 ────────────────────────────
echo "[1/5] 安装系统依赖..."
apt update
apt install -y python3 python3-pip python3-venv ffmpeg git

# ─── 2. 创建应用目录 ─────────────────────────
APP_DIR="/opt/npr-tracker"
echo "[2/5] 设置应用目录: $APP_DIR"

if [ -d "$APP_DIR" ]; then
    echo "  目录已存在，更新文件..."
else
    mkdir -p "$APP_DIR"
fi

# 复制文件（假设脚本在项目根目录运行）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp -r "$SCRIPT_DIR/backend" "$APP_DIR/"
cp -r "$SCRIPT_DIR/frontend" "$APP_DIR/"

# ─── 3. Python 虚拟环境 + 依赖 ───────────────
echo "[3/5] 创建虚拟环境并安装依赖..."
cd "$APP_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt

# 确保缓存目录存在
mkdir -p backend/cache

# ─── 4. 创建 systemd 服务 ────────────────────
echo "[4/5] 配置 systemd 服务..."
cat > /etc/systemd/system/npr-tracker.service << 'EOF'
[Unit]
Description=NPR Transcript Tracker
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/npr-tracker
ExecStart=/opt/npr-tracker/venv/bin/python backend/main.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# ─── 5. 启动服务 ─────────────────────────────
echo "[5/5] 启动服务..."
systemctl daemon-reload
systemctl enable npr-tracker
systemctl restart npr-tracker

# 获取服务器 IP
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "  访问地址: http://$SERVER_IP:8000"
echo ""
echo "  常用命令:"
echo "    查看状态: systemctl status npr-tracker"
echo "    查看日志: journalctl -u npr-tracker -f"
echo "    重启服务: systemctl restart npr-tracker"
echo "    停止服务: systemctl stop npr-tracker"
echo ""
echo "  提示: 请确保服务器安全组/防火墙开放了 8000 端口"
echo "=========================================="
