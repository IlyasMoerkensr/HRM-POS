#!/usr/bin/env sh
# Bouwt ../HRM-Kassa.exe (Windows 64-bit) vanaf Linux, macOS of Windows (Git Bash).
# Vereist Go (https://go.dev). Het icoon (icon.ico) maak je opnieuw met:
#   go run ./tools/mkicon icon.ico
set -e
cd "$(dirname "$0")"
go run github.com/tc-hib/go-winres@v0.3.3 simply --icon icon.ico --manifest gui \
  --product-name "HRM Kassa" --file-description "HRM Kassa - kassasysteem op de achtergrond" \
  --product-version 1.0.0.0 --file-version 1.0.0.0 --arch amd64
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w" -o ../HRM-Kassa.exe .
echo "Klaar: ../HRM-Kassa.exe"
