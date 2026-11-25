# Deploying publicly

The default `docker compose up` is for a trusted network: plain HTTP on port
9090, open sign-ups, development settings. For a server reachable from the
internet, use the production overlay.

## 1. Configure

```sh
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # → SECRET_KEY
```

In `.env` set at least `POSTGRES_PASSWORD`, `SECRET_KEY`, `DOMAIN`,
`DECORATION_ADMIN_IDS` (empty is fine) and keep
`COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`.

`DOMAIN` needs a DNS record pointing at this machine, and ports 80 and 443
forwarded to it. Caddy uses them to get and renew a Let's Encrypt certificate.

## 2. Start

```sh
docker compose up -d --build
docker compose logs -f backend caddy     # first start: migrations, certificate
```

What the overlay changes compared to the plain setup:

| | plain `docker-compose.yml` | with `docker-compose.prod.yml` |
|---|---|---|
| Entry point | nginx on `:9090`, HTTP | Caddy on `:80`/`:443`, HTTPS + HSTS; nginx is not published |
| `ENVIRONMENT` | `development` | `production`: refuses to start with default secrets, hides `/docs` |
| Sign-ups | open | invite-only (`REGISTRATION_MODE`) |
| Client IPs for rate limits | nginx sees clients directly | nginx takes them from Caddy (`deploy/nginx-real-ip.conf`) |

Both run the backend as a non-root user with a read-only filesystem and no
Linux capabilities.

**Already have a TLS proxy** (another Caddy/Traefik, Cloudflare Tunnel, …)?
Skip the overlay's `caddy` service: point your proxy at the frontend
container, set `ENVIRONMENT=production`, and mount `deploy/nginx-real-ip.conf`
(adjust the `set_real_ip_from` ranges to your proxy's address). Make sure your
proxy *replaces* `X-Forwarded-For` rather than appending to it, and adds
`Strict-Transport-Security`.

## 3. First account

With `REGISTRATION_MODE=invite`, the first account on an empty instance can
register without an invite. Create yours right away, then a server, then
invite people with its invite links. Opening a link while logged out leads
through sign-up with the code already filled in.

To stop all sign-ups, set `REGISTRATION_MODE=closed` and
`docker compose up -d`.

## 4. Backups

```sh
scripts/backup.sh                       # → backups/db-<time>.dump, static-<time>.tar.gz
```

Run it daily from cron (`crontab -e`):

```
15 3 * * * cd /path/to/chatter && scripts/backup.sh >> backups/backup.log 2>&1
```

It keeps 14 days (`BACKUP_KEEP_DAYS`). Copy `backups/` to another machine or
disk as well; a backup on the same SD card dies with it. The dumps contain
password hashes and messages, so they're created readable only by you.

### Restore

```sh
docker compose stop backend
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/db-<time>.dump
tar -C backend -xzf backups/static-<time>.tar.gz
docker compose start backend
```

Try a restore once on a spare machine before you need it.

## 5. Updating

```sh
git pull
scripts/backup.sh
docker compose up -d --build              # migrations run on backend start
```

## Not covered yet

See `docs/security_pass.md` for open items. The ones that matter most for a
public instance: attachment URLs are reachable without login (S22), WebSocket
messages aren't rate-limited (S25), invite use counting isn't atomic (S26),
and there is no role hierarchy among admins (S28).
