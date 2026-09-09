// Call within the transaction that creates the orders. The row lock serializes
// checkouts, and rolling back also returns their unused numbers to the sequence.
async function reserveOrderNumbers(connection, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid order count.');
  const [[sequence]] = await connection.query('select next_number from order_sequence where id=1 for update');
  const first = Number(sequence.next_number);
  if (!Number.isSafeInteger(first + count)) throw new Error('Order number limit reached.');
  await connection.execute('update order_sequence set next_number=? where id=1', [first + count]);
  return first;
}

async function backfillOrderNumbers(connection) {
  await connection.beginTransaction();
  try {
    await connection.query('select next_number from order_sequence where id=1 for update');
    const [[last]] = await connection.query('select coalesce(max(order_number),0) as number from orders');
    await connection.execute('update order_sequence set next_number=greatest(next_number,?) where id=1', [Number(last.number) + 1]);
    const [orders] = await connection.query('select id from orders where order_number is null order by created_at,id for update');
    if (orders.length) {
      const first = await reserveOrderNumbers(connection, orders.length);
      for (let index = 0; index < orders.length; index++) {
        await connection.execute('update orders set order_number=? where id=?', [first + index, orders[index].id]);
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

module.exports = { reserveOrderNumbers, backfillOrderNumbers };
