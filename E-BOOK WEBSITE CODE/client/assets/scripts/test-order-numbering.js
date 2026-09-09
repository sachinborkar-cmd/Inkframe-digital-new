// Temporary tables shadow the store tables; no store orders or numbers change.
require('dotenv').config({quiet:true});
const assert = require('node:assert/strict');
const pool = require('../../../server/database');
const {backfillOrderNumbers, reserveOrderNumbers} = require('../../../server/order-numbering');

(async () => {
  const connection = await pool.getConnection();
  try {
    await connection.query(`create temporary table orders (
      id bigint unsigned primary key, order_number bigint unsigned null unique,
      created_at datetime not null
    ) engine=InnoDB`);
    await connection.query(`create temporary table order_sequence (
      id tinyint unsigned primary key, next_number bigint unsigned not null
    ) engine=InnoDB`);
    await connection.query('insert into order_sequence values (1,1)');
    await connection.query("insert into orders(id,created_at) values (35,'2026-09-09'),(5,'2026-09-05 19:37:17'),(3,'2026-09-05 18:27:28'),(2,'2026-09-05 18:27:28')");
    await backfillOrderNumbers(connection);
    const read = async () => (await connection.query('select id,order_number from orders order by order_number'))[0];
    const expected = [{id:2,order_number:1},{id:3,order_number:2},{id:5,order_number:3},{id:35,order_number:4}];
    assert.deepEqual(await read(), expected);
    await backfillOrderNumbers(connection);
    assert.deepEqual(await read(), expected, 'Restart preserves existing numbers');
    await connection.beginTransaction();
    assert.equal(await reserveOrderNumbers(connection, 2), 5);
    await connection.rollback();
    await connection.beginTransaction();
    assert.equal(await reserveOrderNumbers(connection, 2), 5, 'Failed checkout does not consume numbers');
    await connection.query("insert into orders values (80,5,'2026-09-10'),(90,6,'2026-09-10')");
    await connection.commit();
    await connection.query('delete from orders where id=90');
    await backfillOrderNumbers(connection);
    await connection.beginTransaction();
    assert.equal(await reserveOrderNumbers(connection, 1), 7, 'Deleted numbers are never reused');
    await connection.rollback();
    assert.deepEqual((await read()).slice(0,4), expected);
    console.log('PASS: chronological numbering from #1, restart stability, batch allocation, rollback, and no number reuse.');
  } finally {
    await connection.rollback();
    await connection.query('drop temporary table if exists orders, order_sequence');
    connection.release();
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
