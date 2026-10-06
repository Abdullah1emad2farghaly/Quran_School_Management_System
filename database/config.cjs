require('dotenv').config();

const base = {
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT || 3306),
  dialect: 'mysql',
  timezone: '+00:00', // timestamps are stored in UTC
  logging: false,
};

module.exports = { development: base, test: base, production: base };
