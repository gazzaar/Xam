const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config();
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

module.exports = new Pool({
  host: 'localhost',
  user: dbUser,
  database: 'test_nova',
  password: dbPass,
  port: 5432,
});
