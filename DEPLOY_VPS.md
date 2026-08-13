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
4. Di Nginx Proxy Manager buat Proxy Host menuju container `panel` pada port `3000` melalui network Docker yang sama, lalu aktifkan SSL. Jangan membuat Proxy Host untuk executor. Jika NPM berjalan sebagai container terpisah, hubungkan service `panel` ke network NPM terlebih dahulu.
5. Buka domain panel. Database kosong akan menampilkan instalasi awal untuk membuat Administrator pertama.
6. Di Pengaturan panel, isi URL executor dengan `http://executor:8787` dan isi token yang sama dengan `EXECUTOR_TOKEN` pada `.env`, lalu uji koneksi.

## Batas tahap ini

Executor sudah menyimpan job, menerima ZIP, dan mengekstrak release. Docker aplikasi, Composer, database aplikasi, Nginx Proxy Manager API, serta SSL project baru belum diaktifkan; konfigurasi dan handler tahap tersebut dikerjakan setelah panel dan executor sehat di VPS.
