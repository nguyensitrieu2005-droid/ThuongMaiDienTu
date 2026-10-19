require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: fs.existsSync(process.env.DB_CA || '')
    ? { ca: fs.readFileSync(process.env.DB_CA) }
    : { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;