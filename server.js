require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');



const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
const util = require('util');
const SECRET_KEY = process.env.SECRET_KEY;

// Konfigurasi koneksi database
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER, // user MySQL 
  password: process.env.DB_PASS, // password MySQL 
  database: process.env.DB_DATABASE//nama database 
});

// Koneksikan ke database
db.connect((err) => {
  if (err) throw err;
  console.log('Connected to database');
});

// Middleware untuk memverifikasi token JWT dan mengekstrak userId
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Endpoint untuk mendapatkan data dari database
app.get('/api/data', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); 
  const sql = 'SELECT * FROM data_antrian WHERE status !="diterima"  AND DATE(jam_registrasi) = ?'; // ganti dengan nama tabel Anda
  db.query(sql, [today],(err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// Endpoint untuk mendapatkan data dari database order by jam registrasi
app.get('/api/data/orderbyjam', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); 
  const sql = 'SELECT * FROM data_antrian WHERE status !="diterima" AND DATE(jam_registrasi) = ? ORDER BY data_antrian.jam_registrasi DESC'; // ganti dengan nama tabel Anda
  db.query(sql, [today], (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// Endpoint untuk mendapatkan data dari database kategori racik
app.get('/api/data/racik', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // Mengambil tanggal hari ini dalam format YYYY-MM-DD
  const sql = 'SELECT * FROM data_antrian WHERE kategori_obat = "racik" AND status != "diterima" AND DATE(jam_registrasi) = ?';
  
  db.query(sql, [today], (err, results) => {
    if (err) {
      console.error('Error fetching data:', err);
      return res.status(500).send({ message: 'Error fetching data' });
    }
    res.json(results);
  });
});


// Endpoint untuk mendapatkan data dari database kategori non-racik
app.get('/api/data/nonracik', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // Mengambil tanggal hari ini dalam format YYYY-MM-DD
  const sql = 'SELECT * FROM data_antrian WHERE kategori_obat = "Non racik" AND status != "diterima" AND DATE(jam_registrasi) = ?';

  db.query(sql, [today], (err, results) => {
    if (err) {
      console.error('Error fetching data:', err);
      return res.status(500).send({ message: 'Error fetching data' });
    }
    res.json(results);
  });
});


// Convert db.query to return a promise
db.queryPromise = util.promisify(db.query).bind(db);


// Endpoint untuk menambahkan data dengan otentikasi
app.post('/api/data/add', authenticateToken, async (req, res) => {
  try {
    const { name, kategori, status, noRM, jKelamin, poliklinik, alamat, penjamin, tanggal_lahir } = req.body;
    const jamRegistrasi = new Date();
    const estimasiSelesai = new Date(jamRegistrasi);
    const userId = req.user.id; // Mengambil userId dari token yang telah diverifikasi

    // Generate queue number
    let queueNumber;
    if (kategori === 'Racik') {
      estimasiSelesai.setMinutes(estimasiSelesai.getMinutes() + 60);
      queueNumber = await generateQueueNumber('Racik');
    } else if (kategori === 'Non Racik') {
      estimasiSelesai.setMinutes(estimasiSelesai.getMinutes() + 30);
      queueNumber = await generateQueueNumber('Non Racik');
    }

    // Query to get the username
    const sqlUsername = 'SELECT username FROM users WHERE id = ?';
    db.query(sqlUsername, [userId], (err, resultUsername) => {
      if (err) {
        console.error('Error fetching username:', err);
        return res.status(500).send({ message: 'Error fetching username' });
      }

      if (resultUsername.length > 0) {
        const username = resultUsername[0].username;

        // Insert data into data_antrian
        const sql = 'INSERT INTO data_antrian (no_urut, nama_pasien, kategori_obat, status, jam_registrasi, est_selesai, no_rm, j_kelamin, poli_klinik, alamat, penjamin, tgl_lahir, create_by_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        db.query(sql, [queueNumber, name, kategori, status, jamRegistrasi, estimasiSelesai, noRM, jKelamin, poliklinik, alamat, penjamin, tanggal_lahir, username], (err, result) => {
          if (err) {
            console.error('Error inserting data:', err);
            return res.status(500).send({ message: 'Error inserting data' });
          }
          res.status(201).send({ message: 'Data added successfully', data: result });
        });
      } else {
        return res.status(400).send({ message: 'Username not found' });
      }
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send({ message: 'Error processing request' });
  }
});

// Function to generate queue number
async function generateQueueNumber(kategori) {
  // Get today's date
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  // Determine the prefix based on category
  const prefix = kategori === 'Racik' ? 'R' : 'NR';

  // Check if there are any queues for today in the specified category
  const sql = `SELECT * FROM data_antrian WHERE DATE(jam_registrasi) = ? AND kategori_obat = ?`;
  const rows = await db.queryPromise(sql, [today, kategori]);

  // If no queues for today, set initial queue number to 0001
  if (rows.length === 0) {
    return `${prefix}0001`;
  }

  // If queues exist for today, get the last queue number
  const lastQueue = rows[rows.length - 1];
  const lastQueueNumber = lastQueue.no_urut.substring(prefix.length);

  // Increment the last queue number and pad with zeros
  const nextQueueNumber = parseInt(lastQueueNumber) + 1;
  const paddedQueueNumber = nextQueueNumber.toString().padStart(4, '0');

  return `${prefix}${paddedQueueNumber}`;
}

//endpoin mendapatkan username dari token
app.post('/user', authenticateToken, (req, res) => {
  const username = req.user.username;
  res.json({ username: username });
});

// Endpoint untuk update status user
app.post('/update-status', authenticateToken, (req, res) => {
  const { id, status } = req.body;
  const creater = req.user.username;

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


 // Menghasilkan timestamp dalam WIB menggunakan toLocaleString
 const options = {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false // memastikan format 24 jam
};

const formatter = new Intl.DateTimeFormat('en-CA', options);
const parts = formatter.formatToParts(new Date());
const timestamp = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value} ${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}:${parts.find(p => p.type === 'second').value}`;

const query = `UPDATE data_antrian SET status = ?, ${column} = ?, ${column2} = ? WHERE id = ?`;
  db.query(query, [status, timestamp, creater, id], (err, result) => {
    if (err) {
      console.error("Error updating status:", err);
      res.status(500).send("Error updating status");
      return;
    }
    res.send("Status updated successfully");
  });
});


// Endpoint to delete a patient
app.post('/delete-patient', (req, res) => {
  const { id } = req.body;
  const query = 'DELETE FROM data_antrian WHERE id = ?';
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error('Error deleting patient:', err);
      res.status(500).json('Error deleting patient');
    } else {
      res.json(`Patient with id ${id} deleted successfully`);
    }
  });
});


app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  // Validasi input
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Semua kolom wajib diisi' });
  }

  try {
    // Periksa apakah username atau email sudah terdaftar
    const checkUserSql = 'SELECT * FROM users WHERE email = ? OR username = ?';
    db.query(checkUserSql, [email, username], async (err, results) => {
      if (err) throw err;

      if (results.length > 0) {
        return res.status(400).json({ error: 'Email atau username sudah terdaftar' });
      }

      // Hash password
      const hash = await bcrypt.hash(password, 10);

      // Simpan user baru ke database
      const insertUserSql = `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`;
      db.query(insertUserSql, [username, email, hash], (err, result) => {
        if (err) throw err;
        res.status(201).json({ message: 'Berhasil Mendaftar, Silahkan Login!' });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Login Endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const sql = 'SELECT * FROM users WHERE username = ?';
  db.query(sql, [username], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (result.length > 0) {
      const user = result[0];
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) {
          return res.status(500).json({ error: 'Password comparison failed' });
        }

        if (isMatch) {
          const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
          return res.json({ token });
        } else {
          return res.status(400).json({ error: 'Password incorrect' });
        }
      });
    } else {
      return res.status(400).json({ error: 'No user found' });
    }
  });
});

app.get('/input', (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).send('Access denied');
  try {
    const verified = jwt.verify(token, SECRET_KEY);
    res.json(verified);
  } catch (err) {
    res.status(400).send('Invalid token');
  }
});

//endpoint filter data by tanggal
app.get('/data/filter', (req, res) => {
  const { startDate, endDate } = req.query;
  const query = `
  SELECT * FROM data_antrian WHERE jam_registrasi BETWEEN ? AND ?
  `;
  db.query(query, [startDate, endDate], (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// Fungsi listen untuk membuat server mendengarkan koneksi pada port tertentu
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
