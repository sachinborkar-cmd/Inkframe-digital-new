const pool = require('./database');
module.exports = async function securitySchema() {
  const add = async (table, column, definition) => {
    const [rows] = await pool.execute('select 1 from information_schema.columns where table_schema=database() and table_name=? and column_name=?',[table,column]);
    if (!rows.length) await pool.query(`alter table ${table} add column ${column} ${definition}`);
  };
  await pool.query('create table if not exists schema_migrations (name varchar(100) primary key, applied_at timestamp default current_timestamp)');
  await add('users','role',"enum('CUSTOMER','ADMIN') not null default 'CUSTOMER'");
  await add('users','is_owner','boolean not null default false');
  await add('users','password_hash','varchar(255) null');
  await add('users','session_version','int unsigned not null default 0');
  await add('users','is_active','boolean not null default true');
  await add('otp_codes','purpose',"enum('SIGN_IN','PASSWORD_RESET') not null default 'SIGN_IN'");
  await pool.query(`create table if not exists email_change_codes (
    user_id bigint unsigned not null primary key, email varchar(254) not null,
    token char(64) not null, otp_hash varchar(255) not null, attempts int unsigned not null default 0,
    expires_at datetime not null, consumed_at datetime null,
    constraint fk_email_change_user foreign key(user_id) references users(id) on delete cascade
  ) engine=InnoDB`);
  await add('orders','verified_at','datetime null');
  await add('orders','gateway_payment_id','varchar(100) null unique');
  await add('orders','gateway_order_id','varchar(100) null');
  const [[statusColumn]]=await pool.query("select column_type as definition from information_schema.columns where table_schema=database() and table_name='orders' and column_name='status'");
  if(!statusColumn.definition.includes("'failed'"))await pool.query("alter table orders modify status enum('pending','paid','refunded','cancelled','failed') not null default 'pending'");
  await pool.query(`create table if not exists password_reset_grants (
    token_hash char(64) primary key, user_id bigint unsigned not null, expires_at datetime not null,
    consumed_at datetime null, constraint fk_reset_user foreign key(user_id) references users(id) on delete cascade
  ) engine=InnoDB`);
  await pool.query(`create table if not exists auth_rate_limits (
    bucket char(64) primary key, hits int unsigned not null default 1, expires_at datetime not null,
    key idx_rate_expiry(expires_at)
  ) engine=InnoDB`);
  const c=await pool.getConnection();
  await pool.query('delete from auth_rate_limits where expires_at<now()');
  try {
    await c.beginTransaction();
    const [claim]=await c.execute("insert ignore into schema_migrations(name) values ('database-admin-roles-v1')");
    if(claim.affectedRows){
      await c.execute("update users u join admin_members a on a.email=u.email set u.role='ADMIN' where u.is_verified=1");
      const owner=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
      if(owner)await c.execute("update users set role='ADMIN',is_owner=1 where email=? and is_verified=1",[owner]);
    }
    await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
};
