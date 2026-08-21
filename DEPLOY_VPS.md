# Menjalankan NEXDEPLOY di VPS

Dokumen ini menyiapkan panel dan executor. Tidak ada port executor yang dibuka ke internet.

## Prasyarat

- Docker Engine dan Docker Compose Plugin telah terpasang di VPS.
- Nginx Proxy Manager telah berjalan dan dapat meneruskan trafik ke port lokal VPS.
- Domain panel sudah mengarah ke IP VPS.

## Konfigurasi awal

1. Salin `.env.example` menjadi `.env` di folder root, lalu isi `NEXDEPLOY_ENCRYPTION_KEY` dan `EXECUTOR_TOKEN` dengan nilai acak yang berbeda.
2. Jalankan `docker compose up -d --build`.
3. Pastikan `docker compose ps` menampilkan `panel` dan `executor` dengan status berjalan.
4. Di Nginx Proxy Manager buat Proxy Host menuju container `panel` pada port `3000` melalui network Docker yang sama, lalu aktifkan SSL. Jangan membuat Proxy Host untuk executor. Jika ingin menjalankan NPM dari repo ini, gunakan `docker-compose.npm.yml`.
5. Buka domain panel. Database kosong akan menampilkan instalasi awal untuk membuat Administrator pertama.
6. Di Pengaturan panel, isi URL executor dengan `http://executor:8787` dan isi token yang sama dengan `EXECUTOR_TOKEN` pada `.env`, lalu uji koneksi.

## Menjalankan Nginx Proxy Manager dari repo ini

NEXDEPLOY menyediakan file compose tambahan `docker-compose.npm.yml`. File ini sengaja dipisah dari `docker-compose.yml` utama agar tidak otomatis mengambil port 80/443 pada VPS yang sudah punya reverse proxy lain.

Jalankan NPM:

```bash
docker compose -f docker-compose.yml -f docker-compose.npm.yml up -d nginx-proxy-manager
```

Admin UI NPM:

```text
http://IP-VPS:81
```

Login default Nginx Proxy Manager:

```text
Email: admin@example.com
Password: changeme
```

Segera ubah email dan password setelah login pertama.

Proxy Host untuk panel NEXDEPLOY:

```text
Domain Names: panel.domainanda.com
Scheme: http
Forward Hostname / IP: panel
Forward Port: 3000
Block Common Exploits: ON
Websockets Support: ON
SSL: Request a new SSL Certificate
Force SSL: ON
HTTP/2 Support: ON
```

Proxy Host untuk project Laravel yang sudah deploy:

1. Ambil stable host port dari log panel atau executor, misalnya `20000`.
2. Buat Proxy Host di NPM:

```text
Domain Names: nama-project.domainanda.com
Scheme: http
Forward Hostname / IP: host.docker.internal
Forward Port: 20000
Block Common Exploits: ON
Websockets Support: ON
SSL: Request a new SSL Certificate
Force SSL: ON
HTTP/2 Support: ON
```

Jangan expose atau proxy service `executor`. Executor hanya untuk komunikasi internal panel.

## Konfigurasi executor (Phase 1 — Laravel runtime)

Variabel lingkungan opsional berikut dibaca oleh executor (lihat `executor/.env.example`):

- `DEPLOY_PORT_MIN` (default `20000`) — batas bawah rentang host port yang dialokasikan untuk kontainer aplikasi.
- `DEPLOY_PORT_MAX` (default `29999`) — batas atas rentang tersebut.

Rentang ini otomatis menghindari port yang sedang LISTEN di host, port yang sudah dipakai container Docker lain, serta port panel (`8088`) dan executor (`8787`).

Executor memerlukan akses ke Docker socket (`/var/run/docker.sock`, sudah dipasang di `docker-compose.yml`) untuk build image dan menjalankan kontainer aplikasi. Socket ini **tidak** pernah diteruskan ke dalam kontainer aplikasi yang di-deploy.

## Alur deployment Laravel (Phase 1)

```
ZIP diunggah
  -> validasi arsip
  -> ekstraksi release
  -> preparing      (siapkan .env, composer install)
  -> building        (npm build jika ada, docker build image)
  -> starting         (buat network, alokasikan port, jalankan kontainer)
  -> health_check   (poll HTTP hingga ~60 detik)
  -> running          (kontainer lama milik project yang sama dibersihkan)
```

Jika release bukan proyek Laravel (tidak ada `artisan` + `composer.json`), job berhenti di `waiting_vps` seperti sebelumnya. Kegagalan di tahap manapun membuat job berstatus `failed` dengan pesan error yang sudah disaring (tanpa token/secret).

## Batas tahap ini

Belum diimplementasikan (menunggu fase berikutnya):

- Provisioning database (PostgreSQL/MariaDB) — Phase 1 menjalankan Laravel dengan `DB_CONNECTION=sqlite` placeholder, tanpa migrasi.
- Integrasi Nginx Proxy Manager otomatis untuk project yang di-deploy (hanya panel yang punya Proxy Host manual).
- Otomasi domain dan SSL per-project.
- Rollback/riwayat rilis dan zero-downtime penuh (Phase 1 hanya memastikan kontainer lama tidak dimatikan sebelum kontainer baru lolos health check).

Web server aplikasi Laravel yang di-generate NEXDEPLOY untuk Phase 1 adalah `php artisan serve` di dalam image `php:8.3-cli-alpine` (lihat `executor/tpl/laravel.Dockerfile`) — cukup untuk membuktikan ZIP -> container -> HTTP reachable, belum production-grade (php-fpm + nginx) seperti direncanakan untuk fase berikutnya.
