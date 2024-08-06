'use strict';

const Hapi = require('@hapi/hapi');
const mysql = require('mysql2/promise');

const init = async () => {

    const server = Hapi.server({
        port: 5000,
        host: '0.0.0.0'
    });

    // Create a connection pool to the MySQL database
    const pool = mysql.createPool({
        host: '180.254.158.159',
        user: 'newuser2',
        password: 'Zulfath423#',
        database: 'data_pasien'
    });

    // Sample route to fetch data from MySQL
    server.route({
        method: 'GET',
        path: '/',
        handler: async (request, h) => {
            let connection;
            try {
                connection = await pool.getConnection();
                const [rows, fields] = await connection.execute('SELECT * data_antrian');
                return rows;
            } catch (err) {
                console.error(err);
                return h.response('Internal Server Error').code(500);
            } finally {
                if (connection) connection.release();
            }
        }
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();
