@echo off
setlocal

set REMOTE_HOST=your-vm.example.com
set REMOTE_USER=deploy
set REMOTE_PATH=/opt/deepbridge
set SSH_KEY=%USERPROFILE%\.ssh\id_ed25519

echo This is a placeholder deployment template.
echo Replace REMOTE_HOST, REMOTE_USER, REMOTE_PATH, and SSH_KEY locally.
echo Do not commit real values.

ssh -i "%SSH_KEY%" %REMOTE_USER%@%REMOTE_HOST% "mkdir -p %REMOTE_PATH%"
scp -i "%SSH_KEY%" -r . %REMOTE_USER%@%REMOTE_HOST%:%REMOTE_PATH%
ssh -i "%SSH_KEY%" %REMOTE_USER%@%REMOTE_HOST% "cd %REMOTE_PATH% && docker compose up -d --build"
