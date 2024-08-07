require('dotenv').config();
const Hapi = require('@hapi/hapi');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Boom = require('@hapi/boom');
const Joi = require('@hapi/joi');

// Konfigurasi koneksi database
const db = mysql.createConnection({
  host: '0.0.0.0',
  user: 'rspim', // user MySQL 
  password: 'Zulfath423#',
  database: 'data_pasien' // nama database 
});

// Koneksikan ke database
db.connect((err) => {
  if (err) throw err;
  console.log('Connected to database');
});

const SECRET_KEY = process.env.SECRET_KEY;

// Fungsi untuk memverifikasi token JWT dan mengekstrak userId
const authenticateToken = async (request, h) => {
  const authHeader = request.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return Boom.unauthorized();

  try {
    const user = jwt.verify(token, SECRET_KEY);
    request.auth.credentials = user;
    return h.continue;
  } catch (err) {
    return Boom.forbidden();
  }
};

// Fungsi untuk menghasilkan nomor antrian
async function generateQueueNumber(kategori) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const prefix = kategori === 'Racik' ? 'R' : 'NR';
  const sql = `SELECT * FROM data_antrian WHERE DATE(jam_registrasi) = ? AND kategori_obat = ?`;
  const [rows] = await db.promise().query(sql, [today, kategori]);

  if (rows.length === 0) {
    return `${prefix}0001`;
  }

  const lastQueue = rows[rows.length - 1];
  const lastQueueNumber = lastQueue.no_urut.substring(prefix.length);
  const nextQueueNumber = parseInt(lastQueueNumber) + 1;
  const paddedQueueNumber = nextQueueNumber.toString().padStart(4, '0');

  return `${prefix}${paddedQueueNumber}`;
}

// Inisialisasi server Hapi
const init = async () => {
  const server = Hapi.server({
    port: process.env.PORT || 5000,
    host: '0.0.0.0'
  });

  // Register plugins
  await server.register(require('@hapi/cors'));

  // Rute untuk mendapatkan data dari database
  server.route({
    method: 'GET',
    path: '/api/data',
    handler: async (request, h) => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const sql = 'SELECT * FROM data_antrian WHERE status !="diterima" AND DATE(jam_registrasi) = ?';
      const [results] = await db.promise().query(sql, [today]);
      return results;
    }
  });

  // Endpoint untuk mendapatkan data dari database order by jam registrasi
  server.route({
    method: 'GET',
    path: '/api/data/orderbyjam',
    handler: async (request, h) => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const sql = 'SELECT * FROM data_antrian WHERE status !="diterima" AND DATE(jam_registrasi) = ? ORDER BY data_antrian.jam_registrasi DESC';
      const [results] = await db.promise().query(sql, [today]);
      return results;
    }
  });

  // Endpoint untuk mendapatkan data kategori racik
  server.route({
    method: 'GET',
    path: '/api/data/racik',
    handler: async (request, h) => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const sql = 'SELECT * FROM data_antrian WHERE kategori_obat = "racik" AND status != "diterima" AND DATE(jam_registrasi) = ?';
      const [results] = await db.promise().query(sql, [today]);
      return results;
    }
  });

  // Endpoint untuk mendapatkan data kategori non-racik
  server.route({
    method: 'GET',
    path: '/api/data/nonracik',
    handler: async (request, h) => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const sql = 'SELECT * FROM data_antrian WHERE kategori_obat = "Non racik" AND status != "diterima" AND DATE(jam_registrasi) = ?';
      const [results] = await db.promise().query(sql, [today]);
      return results;
    }
  });

  // Endpoint untuk menambahkan data
  server.route({
    method: 'POST',
    path: '/api/data/add',
    options: {
      pre: [{ method: authenticateToken }],
      handler: async (request, h) => {
        try {
          const { name, kategori, status, noRM, jKelamin, poliklinik, alamat, penjamin, tanggal_lahir } = request.payload;
          const jamRegistrasi = new Date();
          const estimasiSelesai = new Date(jamRegistrasi);
          const userId = request.auth.credentials.id;

          let queueNumber;
          if (kategori === 'Racik') {
            estimasiSelesai.setMinutes(estimasiSelesai.getMinutes() + 60);
            queueNumber = await generateQueueNumber('Racik');
          } else if (kategori === 'Non Racik') {
            estimasiSelesai.setMinutes(estimasiSelesai.getMinutes() + 30);
            queueNumber = await generateQueueNumber('Non Racik');
          }

          const [resultUsername] = await db.promise().query('SELECT username FROM users WHERE id = ?', [userId]);
          if (resultUsername.length === 0) {
            return Boom.badRequest('Username not found');
          }
          const username = resultUsername[0].username;

          const sql = 'INSERT INTO data_antrian (no_urut, nama_pasien, kategori_obat, status, jam_registrasi, est_selesai, no_rm, j_kelamin, poli_klinik, alamat, penjamin, tgl_lahir, create_by_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
          const [result] = await db.promise().query(sql, [queueNumber, name, kategori, status, jamRegistrasi, estimasiSelesai, noRM, jKelamin, poliklinik, alamat, penjamin, tanggal_lahir, username]);
          return h.response({ message: 'Data added successfully', data: result }).code(201);
        } catch (err) {
          console.error('Error:', err);
          return Boom.internal('Error processing request');
        }
      }
    }
  });

  // Endpoint untuk update status user
  server.route({
    method: 'POST',
    path: '/update-status',
    options: {
      pre: [{ method: authenticateToken }],
      handler: async (request, h) => {
        const { id, status } = request.payload;
        const creater = request.auth.credentials.username;

        let column = "";
        if (status === "pending") {
          column = "jam_pending";
        } else if (status === "selesai") {
          column = "jam_selesai";
        } else if (status === "diterima") {
          column = "jam_diterima";
        }

        let column2 = "";
        if (status === "pending") {
          column2 = "create_pending";
        } else if (status === "selesai") {
          column2 = "create_selesai";
        } else if (status === "diterima") {
          column2 = "create_diterima";
        }

        const options = {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        };

        const formatter = new Intl.DateTimeFormat('en-CA', options);
        const parts = formatter.formatToParts(new Date());
        const timestamp = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value} ${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}:${parts.find(p => p.type === 'second').value}`;

        const query = `UPDATE data_antrian SET status = ?, ${column} = ?, ${column2} = ? WHERE id = ?`;
        await db.promise().query(query, [status, timestamp, creater, id]);
        return { message: 'Status updated successfully' };
      }
    }
  });

  // Endpoint untuk delete pasien
  server.route({
    method: 'POST',
    path: '/delete-patient',
    handler: async (request, h) => {
      const { id } = request.payload;
      const query = 'DELETE FROM data_antrian WHERE id = ?';
      await db.promise().query(query, [id]);
      return { message: `Patient with id ${id} deleted successfully` };
    }
  });

  // Endpoint untuk registrasi pengguna
  server.route({
    method: 'POST',
    path: '/register',
    handler: async (request, h) => {
      const { username, email, password } = request.payload;

      if (!username || !email || !password) {
        return Boom.badRequest('Semua kolom wajib diisi');
      }

      try {
        const [results] = await db.promise().query('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);
        if (results.length > 0) {
          return Boom.badRequest('Email atau username sudah terdaftar');
        }

        const hash = await bcrypt.hash(password, 10);
        await db.promise().query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hash]);
        return { message: 'Berhasil Mendaftar, Silahkan Login!' };
      } catch (err) {
        console.error(err);
        return Boom.internal('Terjadi kesalahan server');
      }
    }
  });

  // Endpoint login
  server.route({
    method: 'POST',
    path: '/login',
    handler: async (request, h) => {
      const { username, password } = request.payload;
      const [result] = await db.promise().query('SELECT * FROM users WHERE username = ?', [username]);

      if (result.length > 0) {
        const user = result[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
          const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1m' });
          return { token };
        } else {
          return Boom.unauthorized('Password incorrect');
        }
      } else {
        return Boom.unauthorized('No user found');
      }
    }
  });

  // Endpoint untuk filter data berdasarkan tanggal
  server.route({
    method: 'GET',
    path: '/data/filter',
    handler: async (request, h) => {
      const { startDate, endDate } = request.query;
      const query = 'SELECT * FROM data_antrian WHERE jam_registrasi BETWEEN ? AND ?';
      const [results] = await db.promise().query(query, [startDate, endDate]);
      return results;
    }
  });

  // Mulai server
  await server.start();
  console.log(`Server running on ${server.info.uri}`);
};

process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

init();
