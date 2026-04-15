$ErrorActionPreference = "Stop"

git config --global http.proxy http://127.0.0.1:6984
git config --global https.proxy http://127.0.0.1:6984

Write-Host "Git proxy switched to 127.0.0.1:6984"
