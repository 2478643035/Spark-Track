$ErrorActionPreference = "Stop"

git config --global --unset-all http.proxy
git config --global --unset-all https.proxy

Write-Host "Git proxy cleared"
