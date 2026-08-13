# NEXDEPLOY

Panel deployment VPS untuk mengelola project, domain, database, deployment log, dan backup dari satu antarmuka.

## Menjalankan secara lokal

Persyaratan: Node.js 22.13 atau lebih baru.

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

Pada pemakaian pertama, database lokal akan disiapkan otomatis. Tiga akun Administrator awal dibuat otomatis. Ganti seluruh password sebelum panel dipakai di VPS:

```text
ade@nexdeploy.local    / admin123
reza@nexdeploy.local   / admin123
ikbal@nexdeploy.local  / admin123
```

## Build

```bash
npm run build
```

## Keamanan

Jangan simpan password VPS, token API, private key, kredensial database, atau isi `.env` ke repository. Gunakan `.env.example` hanya untuk mendokumentasikan nama variable tanpa nilai rahasia.

## Status

Autentikasi berbasis sesi, penyimpanan project, status start/stop, dan pengaturan panel kini memakai database lokal. Skema database dan migrasinya tersedia di `db/` dan `drizzle/`.

Tahap berikutnya adalah upload ZIP, worker deployment, Docker, Nginx Proxy Manager, provisioning database aplikasi, log deployment, dan backup. Fitur-fitur tersebut belum dihubungkan ke VPS produksi.
