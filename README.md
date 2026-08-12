# NEXDEPLOY

Panel deployment VPS untuk mengelola project, domain, database, deployment log, dan backup dari satu antarmuka.

## Menjalankan secara lokal

Persyaratan: Node.js 22.13 atau lebih baru.

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Build

```bash
npm run build
```

## Keamanan

Jangan simpan password VPS, token API, private key, kredensial database, atau isi `.env` ke repository. Gunakan `.env.example` hanya untuk mendokumentasikan nama variable tanpa nilai rahasia.

## Status

Antarmuka, login role lokal, pembuatan project, dan penyimpanan konfigurasi lokal sudah tersedia. Integrasi backend untuk Docker, Nginx Proxy Manager, database container, upload ZIP, dan deployment worker masih perlu dihubungkan sebelum digunakan pada VPS produksi.
