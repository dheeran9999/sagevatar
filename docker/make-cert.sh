#!/bin/sh
# Creates a self-signed HTTPS certificate for this PC's LAN address(es), used by the Docker web
# container on port 8443 so other devices can use the live camera (browsers require HTTPS).
#
#   sh docker/make-cert.sh <your-LAN-IP> [another-IP ...]   (Git Bash / WSL / macOS / Linux)
#   docker compose restart web
#
# Re-run it whenever your IP address changes. Visitors will see a "not private" warning once —
# choose Advanced → Continue (the certificate is self-signed, not issued by a public authority).
set -e
cd "$(dirname "$0")"
mkdir -p certs
SAN="DNS:localhost,IP:127.0.0.1"
for ip in "$@"; do SAN="$SAN,IP:$ip"; done
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout certs/sagevatar.key -out certs/sagevatar.crt \
  -subj "/CN=SageVatar LAN" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "extendedKeyUsage=serverAuth"
echo "Certificate for: $SAN"
