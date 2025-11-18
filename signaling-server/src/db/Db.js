const { Pool } = require('pg');

const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'voice_chat',
    password: process.env.DB_PASSWORD || 'gkak1021',
    port: process.env.DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false
    },
};

const pool = new Pool(dbConfig);

module.exports = {
    query: (text, params) => pool.query(text, params),

    deleteRoom: async (roomId) => {
        try {
            const result = await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
            console.log(`Room ${roomId} deleted from database.`);
            return result;
        } catch (error) {
            console.error(`Error deleting room ${roomId} from database:`, error);
            throw error;
        }
    },
};