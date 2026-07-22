# Moving the app from "Not secure" to HTTPS

## Why this is blocked right now

The app is served at `http://3.133.43.231` — a bare IP address.

**No public Certificate Authority will issue a TLS certificate for an IP address.**
Let's Encrypt explicitly refuses; so do commercial CAs for practical purposes.
That is a rule of the certificate system, not a limitation of this setup.

Which means:

| Option | Result |
|---|---|
| Keep the bare IP | Permanently "Not secure". No way around it. |
| Self-signed cert on the IP | **Worse** — a full-page red interstitial warning users must click through. |
| **Point a domain at the IP** | Real padlock, free, auto-renewing. **This is the only real fix.** |

**Required first step (only you can do this): pick a hostname and create a DNS
A record pointing it at `3.133.43.231`.** For example:

```
Type: A     Name: app     Value: 3.133.43.231     TTL: 300
```

...giving `app.miraintel.com`. Any domain works; it just has to resolve to this
server over the public internet before a certificate can be issued.

Verify it resolves before continuing:

```bash
dig +short app.miraintel.com
```

That must print `3.133.43.231`. DNS can take anywhere from a minute to a few
hours to propagate.

---

## Once the domain resolves — the actual switch (~20 minutes)

Everything below is prepared and ready; only `YOUR_DOMAIN` needs substituting.

### 1. Add certbot + a challenge volume to the compose file

The `nginx` service needs two shared volumes so certbot and nginx can see the
same certificates and challenge files:

```yaml
  nginx:
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - certbot-www:/var/www/certbot:ro
      - certbot-conf:/etc/letsencrypt:ro

  certbot:
    image: certbot/certbot
    volumes:
      - certbot-www:/var/www/certbot
      - certbot-conf:/etc/letsencrypt
    # Renew twice daily; nginx picks up new certs on reload.
    entrypoint: sh -c 'trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot --quiet; sleep 12h & wait $${!}; done'

volumes:
  certbot-www:
  certbot-conf:
```

### 2. Issue the first certificate

The current HTTP-only config must still be active for this step, plus an ACME
location. Add this to the existing `server { listen 80; }` block:

```nginx
location /.well-known/acme-challenge/ { root /var/www/certbot; }
```

Reload nginx, then request the cert (swap in the real domain and email):

```bash
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d YOUR_DOMAIN --email caryn@miraintel.com --agree-tos --no-eff-email
```

Use `--dry-run` first to test without burning rate limits (Let's Encrypt allows
5 failures per hostname per hour).

### 3. Swap in the TLS config

`nginx/nginx-tls.conf.template` is the complete HTTPS config — HTTP→HTTPS
redirect, TLS 1.2/1.3, and all existing proxy routes (`/api/`, `/storage/`,
`/twin/`, `/twin-data/`, `/`) preserved.

```bash
sed 's/YOUR_DOMAIN/app.miraintel.com/g' nginx/nginx-tls.conf.template > nginx/nginx.conf
docker compose restart nginx
```

### 4. Verify

```bash
curl -sI https://YOUR_DOMAIN | head -1
```

Expect `HTTP/2 200`. Then load it in a browser and confirm the padlock.

### 5. Only after it works — raise HSTS

`nginx-tls.conf.template` ships with `max-age=300` (5 minutes) deliberately.
A long HSTS max-age with a broken certificate makes the site **unreachable** for
that entire duration, with no way to override from the server side. Once HTTPS
is confirmed stable, raise it:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

## Things to know

- **Open port 443.** The EC2 security group currently allows 80; 443 must be
  added or HTTPS will silently time out.
- **The IP keeps working** on plain HTTP unless you also redirect it. Browsers
  will still flag it as insecure, since the cert only covers the domain name.
- **Renewals are automatic** with the certbot service above; certificates last
  90 days and renew at 60. The `/.well-known/acme-challenge/` location must
  remain reachable over HTTP or renewal fails silently — do not remove it.
- **A static IP matters.** If the EC2 instance is stopped/started without an
  Elastic IP, the address changes and DNS breaks. Worth attaching one.
