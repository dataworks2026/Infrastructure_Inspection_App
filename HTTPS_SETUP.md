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

---

## Verified facts about THIS setup (checked 2026-07-22)

| Check | Result |
|---|---|
| Port 80 on `3.133.43.231` | **Open** (returns 200) |
| Port 443 on `3.133.43.231` | **CLOSED / filtered** — must be opened in the AWS security group |
| `miraintel.com` DNS host | **Namecheap** (`dns1/dns2.registrar-servers.com`) — *not* Route 53 |
| `app.miraintel.com` | **ALREADY IN USE** — points at Vercel, live and returning 200. **Do not reuse it**, it would break that site. |
| Free subdomains | `dev`, `inspect`, `inspections`, `platform`, `portal`, `twin`, `console` — all unused |

**Because DNS lives at Namecheap, most of this is NOT an AWS task.** Only one
AWS change is strictly required (opening port 443).

---

## Step 1 — Namecheap: create the A record

Namecheap dashboard → **Domain List** → `miraintel.com` → **Manage** →
**Advanced DNS** → **Add New Record**:

```
Type:  A Record
Host:  inspect          <- the subdomain; NOT "app" (already taken by Vercel)
Value: 3.133.43.231
TTL:   Automatic (or 5 min)
```

Giving `inspect.miraintel.com`. Verify before continuing:

```bash
dig +short inspect.miraintel.com
```

Must print `3.133.43.231`. Usually 5–30 minutes at Namecheap.

## Step 2 — AWS: open port 443 (required)

Certificate issuance and HTTPS both fail silently without this.

EC2 Console → **Instances** → select the instance (`3.133.43.231`) →
**Security** tab → click its **security group** → **Edit inbound rules** →
**Add rule**:

```
Type: HTTPS     Protocol: TCP     Port: 443     Source: 0.0.0.0/0 (Anywhere-IPv4)
```

→ **Save rules**. Leave the existing port 80 rule in place — Let's Encrypt
renewals need it.

## Step 3 — AWS: Elastic IP (recommended, do it BEFORE step 1)

Without one, stopping/starting the instance changes its public IP and silently
breaks DNS and the certificate.

EC2 Console → **Elastic IPs** → **Allocate Elastic IP address** → **Associate**
→ select the instance.

> **Warning — ordering matters.** Associating an Elastic IP *replaces* the
> instance's current public address, so `3.133.43.231` will change. Do this
> **before** creating the DNS record, and point the A record at the new Elastic
> IP instead. If you'd rather not deal with the change now, skip it — just know
> that a stop/start will break HTTPS until DNS is updated.

## Alternative: ACM + Application Load Balancer

AWS-native path — a free auto-renewing ACM certificate terminating TLS at an
ALB, with no certbot on the box. It still requires the domain from step 1, and
an ALB costs roughly **$16–25/month**. For a single dev instance, Let's Encrypt
(free, below) is the better trade. Worth revisiting for production HA.

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
