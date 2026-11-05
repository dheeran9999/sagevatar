# Shared by the HTTP and HTTPS servers in nginx.conf.
root /usr/share/nginx/html;

# Photo uploads are limited to 10 MB by the API; allow some headroom for multipart.
client_max_body_size 25m;

location /api/ {
  proxy_pass http://api:4000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  # Live notifications use a long-lived stream.
  proxy_buffering off;
  proxy_read_timeout 1h;
}

location /media/ {
  proxy_pass http://api:4000;
  proxy_set_header Host $host;
}

# Hashed build assets and vendored models can be cached for a long time.
location /assets/ {
  expires 30d;
  add_header Cache-Control "public, immutable";
}
location /vendor/ {
  expires 7d;
}

# Client-side routes fall back to the SPA.
location / {
  try_files $uri /index.html;
}
