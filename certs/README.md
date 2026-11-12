# Supabase root CA (public certificate, safe to commit)

`supabase-ca.crt` = "Supabase Root 2021 CA", valid until 2031-04-26.
SHA-256: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA

It was read from the pooler TLS handshake. Compare it with the file from
Supabase Dashboard > Project Settings > Database > SSL configuration > Download certificate
(`openssl x509 -in prod-ca-2021.crt -noout -fingerprint -sha256`). If they differ, replace this file.
