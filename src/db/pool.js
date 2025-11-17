const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config();

module.exports = new Pool({
  connectionString: process.env.DB_URL,
  ssl: {
    rejectUnauthorized: false, // required on Railway
  },
});
